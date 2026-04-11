# Sprint D — DLQ Lifecycle: Archival, Retention & OutboxEvent DLQ Report

**Date:** 2026-04-11
**Branch:** Genesis
**Status:** COMPLETE

---

## Objective

Fix three operational gaps: (1) OutboxEvent silently abandons events after max retries with no visibility, (2) WebhookDeadLetter grows indefinitely with no archival, (3) no DLQ metrics surfaced in the admin dashboard.

---

## Task 1 — OutboxEvent Dead Letter

### Problem

`OutboxRelay.ts` line 64 queries `retryCount: { lt: 5 }`. When retryCount reaches 5, the event is silently excluded from all future polls — no DLQ, no alert, no visibility.

### Fix

Modified `OutboxRelay.ts` catch block: when `retryCount + 1 >= 5`, creates `OutboxDeadLetter` record with event data and failure reason, then marks the original `OutboxEvent` as published (terminal state).

### New Model: OutboxDeadLetter

```
originalEventId (unique), eventType, aggregateId, payload, failureReason,
retryCount, firstFailedAt, archivedAt, resolvedAt, resolvedBy
```

### Admin Endpoints

| Method | Path                                        | Purpose                                      |
| ------ | ------------------------------------------- | -------------------------------------------- |
| GET    | `/api/admin/outbox/dead-letter`             | Paginated list of unresolved outbox DLQ      |
| POST   | `/api/admin/outbox/dead-letter/:id/retry`   | Re-insert into OutboxEvent with retryCount=0 |
| POST   | `/api/admin/outbox/dead-letter/:id/resolve` | Mark resolved without retry                  |

---

## Task 2 — DLQ Archival Service

**File:** `apps/api/src/webhooks/DlqArchivalService.ts` (78 lines)

### archiveResolvedEvents(retentionDays)

Soft-archives resolved WebhookDeadLetter events older than retention period. Sets `archivedAt = now()` — never deletes records. Idempotent.

### flagStaleEvents(staleAfterDays)

Finds unresolved events older than threshold, logs warnings with event IDs. Returns stale count for monitoring.

### Scheduling

Daily via `setInterval(24h)` in index.ts alongside outbox relay startup:

- `archiveResolvedEvents(90)` — archive after 90 days
- `flagStaleEvents(30)` — warn after 30 days

### Schema Change

Added `archivedAt DateTime?` to `WebhookDeadLetter` model for soft-archive support.

---

## Task 3 — DLQ Metrics Endpoint

**Endpoint:** `GET /api/webhooks/dashboard/dead-letter/metrics`

Returns:

- `unresolvedTotal`, `resolvedTotal`, `archivedTotal`
- `oldestUnresolvedAt` — age of oldest unresolved event
- `byProvider` — breakdown by social provider
- `byEventType` — breakdown by event type
- `last7Days` — daily trend (created/resolved)
- `outboxDlqTotal` — OutboxDeadLetter unresolved count

---

## Task 4 — Admin UI Enhancements

### New Hooks (useWebhooks.ts)

| Hook                        | Type                   | Endpoint            |
| --------------------------- | ---------------------- | ------------------- |
| `useDlqMetrics()`           | useQuery (30s refetch) | GET metrics         |
| `useOutboxDeadLetter(page)` | useQuery               | GET outbox DLQ list |
| `useRetryOutboxDlq()`       | useMutation            | POST retry          |
| `useResolveOutboxDlq()`     | useMutation            | POST resolve        |

### DeadLetterQueue.tsx — Surgical Additions

1. **Metrics bar** (4 stat cards): Unresolved, Oldest, Archived, Outbox DLQ — auto-refresh 30s
2. **Outbox DLQ collapsible section**: expandable panel below webhook DLQ table with table, retry/resolve actions, pagination

Component grew from 546 to 733 lines (under 800 limit).

---

## Files Summary

### New (3)

| File                                                                     | Lines | Purpose                    |
| ------------------------------------------------------------------------ | ----- | -------------------------- |
| `apps/api/src/outbox/outboxAdminRoutes.ts`                               | 108   | Outbox DLQ admin endpoints |
| `apps/api/src/webhooks/DlqArchivalService.ts`                            | 78    | Archive + stale detection  |
| `infra/prisma/migrations/20260411020000_add_dlq_lifecycle/migration.sql` | 27    | Schema migration           |

### Modified (8)

| File                                                     | Changes                                                   |
| -------------------------------------------------------- | --------------------------------------------------------- |
| `infra/prisma/schema.prisma`                             | +OutboxDeadLetter model, +archivedAt on WebhookDeadLetter |
| `apps/api/src/infrastructure/outbox/OutboxRelay.ts`      | Move to DLQ on maxRetries exhaustion                      |
| `apps/api/src/webhooks/webhookDashboardService.ts`       | +getDlqMetrics() method                                   |
| `apps/api/src/webhooks/webhookDashboardRoutes.ts`        | +metrics endpoint                                         |
| `apps/api/src/index.ts`                                  | +outboxAdminRoutes, +archival scheduling                  |
| `apps/api/src/infrastructure/container/types.ts`         | +DlqArchivalService token                                 |
| `apps/api/src/infrastructure/container/setupServices.ts` | +DlqArchivalService registration                          |
| `apps/admin/hooks/api/useWebhooks.ts`                    | +4 DLQ hooks                                              |
| `apps/admin/components/webhooks/DeadLetterQueue.tsx`     | +metrics bar, +outbox DLQ section                         |

---

## Quality Gates

| Check                            | Result                                |
| -------------------------------- | ------------------------------------- |
| TypeScript build                 | 9/9 tasks, 0 errors                   |
| ESLint                           | 0 errors, 0 warnings                  |
| OutboxDeadLetter model in schema | Present with originalEventId @unique  |
| archivedAt in WebhookDeadLetter  | Present                               |
| OutboxRelay DLQ integration      | outboxDeadLetter.create on maxRetries |
| DeadLetterQueue.tsx line count   | 733 (under 800)                       |
| DlqArchivalService exists        | Yes                                   |
