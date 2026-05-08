/**
 * @file types.ts
 * @description Public types for the webhooks hook module — covers dashboard
 *              metrics, webhook subscriptions (CRUD), webhook events
 *              (list/detail/export), webhook DLQ (retry single/all), and the
 *              outbox DLQ (cross-domain — different endpoint family but
 *              co-located in this module since the admin UI surfaces them
 *              together).
 * @layer infrastructure
 */

// ---------------------------------------------------------------------------
// Dashboard metrics
// ---------------------------------------------------------------------------

export interface DashboardMetrics {
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  successRate: number;
  avgProcessingTime: number;
  queueDepth: number;
  realtimeConnections: number;
  byProvider: Record<
    string,
    {
      total: number;
      success: number;
      failed: number;
      successRate: number;
      avgProcessingTime: number;
    }
  >;
  byEventType: Record<string, number>;
  timeline: Array<{
    timestamp: string;
    total: number;
    success: number;
    failed: number;
  }>;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export interface WebhookSubscription {
  id: string;
  provider: string;
  projectId?: string;
  webhookUrl: string;
  verifyToken?: string;
  eventTypes: string[];
  isActive: boolean;
  eventsReceived: number;
  eventsProcessed: number;
  lastEventAt?: string;
  createdAt: string;
  project?: {
    id: string;
    name: string;
  };
  stats: {
    totalEvents: number;
    recentEvents: number;
    failedEvents: number;
    successRate: number;
  };
}

export interface CreateWebhookSubscriptionInput {
  provider: string;
  projectId?: string;
  eventTypes: string[];
  verifyToken?: string;
}

export interface UpdateWebhookSubscriptionInput {
  isActive?: boolean;
  eventTypes?: string[];
  verifyToken?: string;
  webhookUrl?: string;
}

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

export interface WebhookEvent {
  id: string;
  eventId: string;
  eventType: string;
  provider: string;
  status: string;
  verified: boolean;
  processed: boolean;
  retryCount: number;
  processingTime?: number;
  lastError?: string;
  receivedAt: string;
  processedAt?: string;
  nextRetryAt?: string;
  projectId?: string;
  postId?: string;
  channelId?: string;
}

export interface WebhookEventsFilters {
  page?: number | undefined;
  limit?: number | undefined;
  provider?: string | undefined;
  status?: string | undefined;
  search?: string | undefined;
}

export interface WebhookEventsPage {
  events: WebhookEvent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// ---------------------------------------------------------------------------
// Webhook DLQ
// ---------------------------------------------------------------------------

export interface DeadLetterEvent {
  id: string;
  provider: string;
  eventType: string;
  failureReason: string;
  finalError: string;
  retryCount: number;
  firstFailedAt: string;
  lastRetryAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  originalEvent?: {
    id: string;
    eventId: string;
    accountId: string;
  };
}

export interface DeadLetterFilters {
  page?: number | undefined;
  limit?: number | undefined;
  provider?: string | undefined;
  search?: string | undefined;
}

export interface DeadLetterPage {
  events: DeadLetterEvent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// ---------------------------------------------------------------------------
// DLQ aggregate metrics (lifecycle counters across webhook + outbox families)
// ---------------------------------------------------------------------------

export interface DlqMetrics {
  unresolvedTotal: number;
  oldestUnresolvedAt?: string;
  archivedTotal: number;
  outboxDlqTotal: number;
}

// ---------------------------------------------------------------------------
// Outbox DLQ (cross-domain — different endpoint family)
// ---------------------------------------------------------------------------

export interface OutboxDeadLetterEntry {
  id: string;
  createdAt: string;
  eventType: string;
  aggregateId: string;
  retryCount: number;
  aggregateType?: string;
  status?: string;
  lastError?: string;
  resolvedAt?: string;
  [key: string]: unknown;
}

export interface OutboxDeadLetterPage {
  items: OutboxDeadLetterEntry[];
  total: number;
  page: number;
  limit: number;
}
