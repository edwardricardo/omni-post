# OmniPost — Webhooks API Reference

## Overview

The webhook domain handles inbound social media webhook processing (8 providers), billing webhook reception (Stripe/Paddle), real-time event broadcasting via WebSocket and SSE, a dead-letter queue (DLQ) with retry and archival, and an admin dashboard for metrics, event search, and DLQ management. The system uses BullMQ for async processing and Redis pub/sub for cross-server event distribution.

---

## API Layer (`apps/api/`)

### UniversalWebhookHandler

**File:** `apps/api/src/webhooks/webhookHandlerCore.ts`
**Layer:** infrastructure
**Description:** Core webhook processing facade. Handles signature verification, event storage, deduplication (by provider+eventId), retry logic (max 3, exponential backoff), dead-letter queue routing, and processing stats.

#### Supported Providers

| Provider    | Processor Class             | Signature Verification |
| ----------- | --------------------------- | ---------------------- |
| Instagram   | `InstagramWebhookProcessor` | Hub signature          |
| Facebook    | `FacebookWebhookProcessor`  | Hub signature          |
| X (Twitter) | `XWebhookProcessor`         | CRC-based              |
| YouTube     | `YouTubeWebhookProcessor`   | Google channel ID      |
| TikTok      | `TikTokWebhookProcessor`    | TikTok signature       |
| LinkedIn    | `LinkedInWebhookProcessor`  | LinkedIn signature     |
| Snapchat    | `SnapchatWebhookProcessor`  | Snapchat signature     |
| Telegram    | `TelegramWebhookProcessor`  | Update ID              |

#### Methods

| Method               | Signature                                                                                                                   | Returns                                            | Description                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `handleWebhook`      | `(provider: Provider, signature: string, payload: string, headers: Record<string, string>, query?: Record<string, string>)` | `Promise<WebhookProcessingResult>`                 | Main entry: verify, dedupe, store, process, mark complete or DLQ |
| `getProcessingStats` | `(provider?: Provider, timeRange?: { start, end })`                                                                         | `Promise<Record<string, Record<string, unknown>>>` | Grouped stats by provider and status                             |
| `retryFailedEvents`  | `(maxAge?: Date)`                                                                                                           | `Promise<number>`                                  | Retries events in RETRYING status                                |

**Has JSDoc:** ⚠️ File-level JSDoc; no `@method` tags on public methods.

---

### WebhookManager

**File:** `apps/api/src/webhooks/webhookManager.ts`
**Layer:** infrastructure
**Description:** Subscription management and ingestion orchestrator. Handles CRUD for webhook subscriptions, secret/token generation, BullMQ job dispatch for async processing, and cleanup of old events.

#### Methods

| Method                   | Signature                                                                             | Returns                                                        | Description                                                           |
| ------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `createSubscription`     | `(accountId: string, data: CreateWebhookSubscriptionSchema)`                          | `Promise<{ ...subscription, setupInstructions }>`              | Creates subscription with generated secret key and setup instructions |
| `getSubscriptions`       | `(accountId: string, provider?: Provider)`                                            | `Promise<Array<{ ...safeSub, stats }>>`                        | Lists subscriptions (secret key excluded) with event counts           |
| `updateSubscription`     | `(subscriptionId, accountId, data)`                                                   | `Promise<BatchPayload>`                                        | Updates subscription fields (isActive, eventTypes, verifyToken)       |
| `deleteSubscription`     | `(subscriptionId, accountId)`                                                         | `Promise<{ success: true }>`                                   | Deletes a webhook subscription                                        |
| `processIncomingWebhook` | `(provider, eventType, eventId, signature, payload, headers, accountId?, projectId?)` | `Promise<string>`                                              | Adds webhook to BullMQ queue for async processing                     |
| `getProcessingStats`     | `(accountId, timeRange?)`                                                             | `Promise<{ totalEvents, processedEvents, failedEvents, ... }>` | Comprehensive stats with queue depth and recent errors                |
| `retryFailedEvents`      | `(accountId, maxAgeDays?)`                                                            | `Promise<number>`                                              | Re-queues failed/dead-letter events for retry                         |
| `cleanup`                | `(maxAgeDays?: number)`                                                               | `Promise<{ eventsDeleted, jobsCleanedUp }>`                    | Removes old completed/failed events and jobs                          |
| `shutdown`               | `()`                                                                                  | `Promise<void>`                                                | Gracefully shuts down the job processor                               |

**Has JSDoc:** ⚠️ Has method descriptions but no `@method` tags.

#### Webhook Event Types (22 types)

`POST_PUBLISHED`, `POST_UPDATED`, `POST_DELETED`, `POST_ENGAGEMENT_UPDATE`, `STORY_PUBLISHED`, `STORY_EXPIRED`, `REEL_PUBLISHED`, `LIKE_RECEIVED`, `COMMENT_RECEIVED`, `SHARE_RECEIVED`, `MENTION_RECEIVED`, `ACCOUNT_CONNECTED`, `ACCOUNT_DISCONNECTED`, `PERMISSION_CHANGED`, `RATE_LIMIT_REACHED`, `QUOTA_EXCEEDED`, `API_ERROR`, `VIDEO_PROCESSED`, `VIDEO_MONETIZED`, `LIVE_STREAM_STARTED`, `LIVE_STREAM_ENDED`, `MILESTONE_REACHED`, `VIRAL_CONTENT_DETECTED`

---

### WebhookEventMapper

**File:** `apps/api/src/webhooks/WebhookEventMapper.ts`
**Layer:** infrastructure
**Description:** Anti-corruption layer translating normalized webhook data into strongly-typed domain webhook events. All static methods are pure functions with no I/O side-effects.

#### Methods

| Method           | Signature                                                                                                              | Returns                   | Description                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| `fromNormalized` | `(eventType: WebhookEventType, provider: ProviderName, normalized: Record<string, unknown>, related: RelatedEntities)` | `TypedDomainWebhookEvent` | Creates typed domain event from normalized processor output |

#### Domain Event Types (union `TypedDomainWebhookEvent`)

| Interface                      | Event Types Covered                                               |
| ------------------------------ | ----------------------------------------------------------------- |
| `WebhookPostPublishedEvent`    | POST_PUBLISHED, STORY_PUBLISHED, REEL_PUBLISHED                   |
| `WebhookPostUpdatedEvent`      | POST_UPDATED                                                      |
| `WebhookPostDeletedEvent`      | POST_DELETED                                                      |
| `WebhookAnalyticsUpdatedEvent` | POST_ENGAGEMENT_UPDATE, MILESTONE_REACHED, VIRAL_CONTENT_DETECTED |
| `WebhookEngagementEvent`       | LIKE_RECEIVED, COMMENT_RECEIVED, SHARE_RECEIVED, MENTION_RECEIVED |
| `WebhookVideoEvent`            | VIDEO_PROCESSED, VIDEO_MONETIZED                                  |
| `WebhookLiveStreamEvent`       | LIVE_STREAM_STARTED, LIVE_STREAM_ENDED                            |
| `WebhookStoryExpiredEvent`     | STORY_EXPIRED                                                     |
| `WebhookAccountStatusEvent`    | ACCOUNT_CONNECTED, ACCOUNT_DISCONNECTED, PERMISSION_CHANGED       |
| `WebhookRateLimitEvent`        | RATE_LIMIT_REACHED, QUOTA_EXCEEDED, API_ERROR                     |

**Has JSDoc:** ✅ Full JSDoc on class, `fromNormalized`, and all interfaces.

---

### WebhookDashboardService

**File:** `apps/api/src/webhooks/webhookDashboardService.ts`
**Layer:** infrastructure
**Description:** Dashboard analytics service providing metrics aggregation (by provider, event type, timeline), event search with pagination, DLQ management (list, retry single, retry all, export), and DLQ lifecycle metrics.

#### Methods

| Method                     | Signature                                               | Returns                                                                                                          | Description                                                                                            |
| -------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `getDashboardMetrics`      | `(accountId: string, query: DashboardQueryParams)`      | `Promise<DashboardMetrics>`                                                                                      | Full metrics: totals, success rate, avg processing time, by-provider, by-event-type, 24-point timeline |
| `getRecentEvents`          | `(accountId: string, query: EventsQueryParams)`         | `Promise<{ events, pagination }>`                                                                                | Paginated event search with provider/status/text filtering                                             |
| `getEventDetails`          | `(accountId: string, eventId: string)`                  | `Promise<WebhookEvent>`                                                                                          | Single event with project and post relations                                                           |
| `getSubscriptions`         | `(accountId: string)`                                   | `Promise<Array<{ ...subscription, stats }>>`                                                                     | Subscriptions with aggregated event stats                                                              |
| `getDeadLetterQueue`       | `(accountId: string, query: EventsQueryParams)`         | `Promise<{ events, pagination }>`                                                                                | DLQ events scoped to account with original event data                                                  |
| `retryDeadLetterEvent`     | `(accountId: string, eventId: string, userId?: string)` | `Promise<{ success, message }>`                                                                                  | Marks single DLQ event as resolved for retry                                                           |
| `retryAllDeadLetterEvents` | `(userId?: string)`                                     | `Promise<{ total, queued, failed }>`                                                                             | Batch-resolves all unresolved DLQ events (50-item batches)                                             |
| `exportWebhookEvents`      | `(accountId: string, query: DashboardQueryParams)`      | `Promise<{ csv, count, timeRange }>`                                                                             | CSV export of webhook events                                                                           |
| `getDlqMetrics`            | `()`                                                    | `Promise<{ unresolvedTotal, resolvedTotal, archivedTotal, byProvider, byEventType, last7Days, outboxDlqTotal }>` | DLQ lifecycle metrics with 7-day trend                                                                 |

**Has JSDoc:** ⚠️ File-level JSDoc; no `@method` tags.

---

### DlqArchivalService

**File:** `apps/api/src/webhooks/DlqArchivalService.ts`
**Layer:** application
**Description:** Archives resolved DLQ events and flags stale unresolved events. Soft-archive only (never deletes). Idempotent.

#### Methods

| Method                  | Signature                  | Returns                                          | Description                                               |
| ----------------------- | -------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| `archiveResolvedEvents` | `(retentionDays: number)`  | `Promise<{ archived: number }>`                  | Soft-archives resolved events older than retention period |
| `flagStaleEvents`       | `(staleAfterDays: number)` | `Promise<{ stale: number; eventIds: string[] }>` | Logs warnings for stale unresolved events                 |

**Has JSDoc:** ✅ Both methods have `@method` and `@description` tags.

---

### RealtimeWebhookBroadcaster

**File:** `apps/api/src/webhooks/realtimeWebhookBroadcaster.ts`
**Layer:** infrastructure
**Description:** WebSocket + Redis pub/sub + SSE broadcaster for real-time webhook event delivery. Supports connection filtering by account, project, event type, and provider. Includes heartbeat-based cleanup (30min timeout).

#### Methods

| Method                      | Signature                                            | Returns                                                                              | Description                                          |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `addConnection`             | `(connectionId, userId, accountId, socket, config?)` | `void`                                                                               | Registers WebSocket connection with optional filters |
| `removeConnection`          | `(connectionId: string)`                             | `void`                                                                               | Removes WebSocket connection and cleans up indexes   |
| `broadcastWebhookEvent`     | `(event: WebhookEventBroadcast)`                     | `Promise<void>`                                                                      | Broadcasts to relevant WS connections + SSE + Redis  |
| `broadcastEngagementUpdate` | `(postId, provider, metrics, delta?)`                | `Promise<void>`                                                                      | Broadcasts engagement update for a specific post     |
| `broadcastPostStatusChange` | `(postId, newStatus, provider, metadata?)`           | `Promise<void>`                                                                      | Broadcasts post status change                        |
| `broadcastSystemAlert`      | `(accountId, alertType, message, details?)`          | `Promise<void>`                                                                      | Broadcasts system alert (rate limit, error)          |
| `subscribeSSE`              | `(accountId: string, callback: SSEListenerCallback)` | `() => void`                                                                         | Subscribes SSE client; returns unsubscribe function  |
| `getConnectionStats`        | `()`                                                 | `{ totalConnections, connectionsByAccount, connectionsByProject, sseSubscriptions }` | Returns connection statistics                        |
| `shutdown`                  | `()`                                                 | `void`                                                                               | Closes all connections and clears state              |

**Has JSDoc:** ⚠️ Has method descriptions but no `@method` tags.

---

## REST Endpoints

### Webhook Dashboard Routes (`webhookDashboardRoutes.ts`)

All require `requireAdminAuth` + `Permission.WEBHOOK_MANAGE`.

| Method | Path                                                 | Description                                      |
| ------ | ---------------------------------------------------- | ------------------------------------------------ |
| GET    | `/api/webhooks/dashboard/metrics`                    | Dashboard metrics (time range: 1h/6h/24h/7d/30d) |
| GET    | `/api/webhooks/dashboard/events`                     | Recent events with pagination and search         |
| GET    | `/api/webhooks/dashboard/events/:eventId`            | Event details                                    |
| GET    | `/api/webhooks/dashboard/subscriptions`              | Webhook subscriptions overview                   |
| GET    | `/api/webhooks/dashboard/dead-letter`                | Dead letter queue events                         |
| GET    | `/api/webhooks/dashboard/dead-letter/metrics`        | DLQ lifecycle metrics and trends                 |
| POST   | `/api/webhooks/dashboard/dead-letter/retry-all`      | Retry all unresolved DLQ events                  |
| POST   | `/api/webhooks/dashboard/dead-letter/:eventId/retry` | Retry single DLQ event                           |
| GET    | `/api/webhooks/dashboard/stream`                     | Server-Sent Events stream (real-time)            |
| GET    | `/api/webhooks/dashboard/export`                     | Export webhook events as CSV                     |

### Billing Webhook Routes (`billingWebhookRoutes.ts`)

| Method | Path               | Auth                                         | Description                                   |
| ------ | ------------------ | -------------------------------------------- | --------------------------------------------- |
| POST   | `/webhooks/stripe` | Stripe signature (`stripe-signature` header) | Stripe webhook receiver with raw body parsing |
| POST   | `/webhooks/paddle` | Paddle signature (`paddle-signature` header) | Paddle webhook receiver with raw body parsing |

---

## Admin Portal (`apps/admin/`)

| File                                           | Type      | Description                                                                                                                |
| ---------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `app/(dashboard)/webhooks/page.tsx`            | Page      | Webhook dashboard with metrics, events, DLQ                                                                                |
| `components/webhooks/WebhookEventsList.tsx`    | Component | Paginated webhook event list with search                                                                                   |
| `components/webhooks/WebhookMetrics.tsx`       | Component | Metrics overview (totals, success rate, by-provider)                                                                       |
| `components/webhooks/WebhookTimeline.tsx`      | Component | Timeline chart of webhook events                                                                                           |
| `components/webhooks/WebhookSubscriptions.tsx` | Component | Subscription management table                                                                                              |
| `components/webhooks/DeadLetterQueue.tsx`      | Component | DLQ table with retry/retry-all actions                                                                                     |
| `components/maintenance/QueueHealthPanel.tsx`  | Component | Queue health monitoring (references webhook queues)                                                                        |
| `hooks/api/useWebhooks.ts`                     | Hook      | `useWebhookMetrics` (auto-refresh 30s), `useDlqMetrics`, `useOutboxDeadLetter`, `useRetryOutboxDlq`, `useResolveOutboxDlq` |

---

## Client Portal (`apps/client/`)

| File                                                  | Type      | Description                                                  |
| ----------------------------------------------------- | --------- | ------------------------------------------------------------ |
| `app/dashboard/settings/integrations/page.tsx`        | Page      | Integration settings including webhook configuration         |
| `components/settings/AddWebhookForm.tsx`              | Component | Form for adding client-side webhook endpoints                |
| `components/settings/ExternalNotificationConfigs.tsx` | Component | External notification configurations (webhook/Slack/Discord) |
| `hooks/api/useExternalNotifications.ts`               | Hook      | Hooks for managing external webhook notification configs     |
| `lib/integrations/registry.ts`                        | Utility   | Integration registry referencing webhook capabilities        |
