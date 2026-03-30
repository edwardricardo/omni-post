# Critical Gaps Sprint Report

Date: 2026-03-30

## Summary

| Batch | Gap                        | Score | Status | Tests  |
| ----- | -------------------------- | ----- | ------ | ------ |
| 1     | Analytics ingestion worker | 23    | Done   | 14     |
| 2     | Custom reports real data   | 19    | Done   | 8      |
| 3     | Inbox sync worker          | 18    | Done   | 12     |
| 4     | Task management UI         | 18    | Done   | 0 (UI) |
| 5     | SSO settings page          | 15    | Done   | 0 (UI) |

## Batch 1 — Analytics Ingestion Worker

Architecture: Option A — Coordinator pattern (1 BullMQ job per channel)
Queue: ANALYTICS_AGGREGATION (already existed in constants, now wired)
Cron: every 6 hours (BullMQ repeatable)

Files created:

- `apps/api/src/domain/repositories/AnalyticsWriteRepository.ts` — Port for analytics upserts
- `apps/api/src/infrastructure/repositories/PrismaAnalyticsWriteRepository.ts` — Prisma adapter
- `apps/api/src/infrastructure/repositories/PrismaChannelQueryForIngestion.ts` — Channel query across accounts
- `apps/api/src/application/analytics/IngestChannelAnalyticsUseCase.ts` — Fetches + upserts for 1 channel
- `apps/api/src/application/analytics/DispatchAnalyticsIngestionUseCase.ts` — Coordinator enqueues jobs
- `apps/workers/src/analyticsIngestWorker.ts` — BullMQ consumer (concurrency 5)
- `apps/api/tests/unit/application/ingestChannelAnalytics.test.ts` (7 tests)
- `apps/api/tests/unit/application/dispatchAnalyticsIngestion.test.ts` (7 tests)

DI tokens added: QueuePort, AnalyticsWriteRepository, ChannelQueryForIngestion, IngestChannelAnalyticsUseCase, DispatchAnalyticsIngestionUseCase

Impact: Analytics dashboard now receives real data for connected channels every 6 hours.

## Batch 2 — Custom Reports Real Data

File modified: `apps/api/src/application/custom-reports/RunCustomReportQuery.ts`
Change: Math.random() replaced with real Prisma aggregation via AnalyticsAggregationQueryPort

Files created:

- `apps/api/src/domain/repositories/AnalyticsAggregationQueryPort.ts` — Port for report queries
- `apps/api/src/infrastructure/repositories/PrismaAnalyticsAggregationQuery.ts` — Prisma adapter
- `apps/api/tests/unit/application/runCustomReport.test.ts` (8 tests)

Added `hasData: boolean` to RunCustomReportOutput for empty-state handling.
Updated existing tests in `customReportUseCases.test.ts` for new API.

Impact: Report builder shows real analytics metrics. Returns `hasData: false` gracefully when no data exists.

## Batch 3 — Inbox Sync Worker

Completed: SyncProviderCommentsUseCase Step 7 (provider adapter wired)

- Fetches comments via `adapter.getComments()` with cursor pagination
- Maps ProviderComment to IngestSocialMessageInput
- Deduplication via IngestSocialMessageUseCase's existing `findByProviderMessageId`

Queue: INBOX_SYNC (new, added to constants)
Cron: every 30 minutes

Files created:

- `apps/api/src/application/inbox/DispatchInboxSyncUseCase.ts` — Coordinator
- `apps/workers/src/inboxSyncWorker.ts` — BullMQ consumer (concurrency 5)
- `apps/api/tests/unit/application/syncProviderComments.test.ts` (7 tests)
- `apps/api/tests/unit/application/dispatchInboxSync.test.ts` (5 tests)

Impact: Inbox receives messages proactively every 30 minutes, not just via webhooks.

## Batch 4 — Task Management UI

Hook: `apps/client/hooks/api/useTasks.ts` (useTasks, useTask, useCreateTask, useUpdateTask, useCompleteTask, useCancelTask)

Components:

- `apps/client/components/tasks/TaskBadge.tsx` — PriorityBadge + StatusBadge
- `apps/client/components/tasks/TaskCard.tsx` — Individual task card with actions
- `apps/client/components/tasks/TaskList.tsx` — Filterable list with status tabs
- `apps/client/components/tasks/CreateTaskModal.tsx` — Quick creation form
- `apps/client/components/tasks/TaskDetailPanel.tsx` — Slide-over detail panel

Page: `apps/client/app/dashboard/tasks/page.tsx`
Navigation: Tasks added to client sidebar (ClipboardList icon)

## Batch 5 — SSO Settings Page

Hook: `apps/client/hooks/api/useSso.ts` (useSamlConfig, useOidcConfig, useConfigureSaml, useConfigureOidc, useEnableSaml, useEnableOidc, useDisableSso)

Components:

- `apps/client/components/settings/sso/SsoStatusBanner.tsx` — Active/inactive status with disable confirmation
- `apps/client/components/settings/sso/SamlConfigForm.tsx` — IdP config + SP metadata (copy-to-clipboard)
- `apps/client/components/settings/sso/OidcConfigForm.tsx` — OIDC config + redirect URI
- `apps/client/components/settings/sso/SsoSettings.tsx` — Main component with SAML/OIDC tabs

Page: `apps/client/app/dashboard/settings/sso/page.tsx`
Safety: Test-before-enable flow, confirmation dialog for disable, emergency info

## Impact on Code Review Findings

| Finding                           | Before                | After                   |
| --------------------------------- | --------------------- | ----------------------- |
| Analytics shows empty data        | No worker             | Worker ingests every 6h |
| Custom reports show Math.random() | Fake data             | Real Prisma aggregation |
| Inbox only receives webhooks      | No polling            | Polls every 30 min      |
| Tasks backend with no UI          | 7 endpoints, 0 pages  | Full task management    |
| SSO backend with no UI            | 13 endpoints, 0 pages | SAML + OIDC settings    |

## Build and Test

| Check                   | Result                           |
| ----------------------- | -------------------------------- |
| TypeScript build        | 0 errors, 9/9 tasks              |
| All tests               | 335 files, 7029 passed, 0 failed |
| Architecture boundaries | 0 @infra/prisma in application   |
| Math.random in reports  | 0 occurrences                    |
| Analytics worker        | Registered                       |
| Inbox sync worker       | Registered                       |
| Task page               | Exists                           |
| SSO page                | Exists                           |
