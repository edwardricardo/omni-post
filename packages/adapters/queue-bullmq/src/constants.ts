/**
 * Centralized BullMQ queue name constants.
 *
 * Every producer, consumer, and dashboard MUST reference these constants
 * instead of hardcoding queue name strings. This prevents name mismatches
 * (e.g. "publish" vs "publishing") that cause dashboards to read from the
 * wrong Redis key space.
 *
 * @module adapters/queue-bullmq/constants
 */

export const QUEUE_NAMES = {
  /** Main content publishing queue (producer + worker) */
  PUBLISH: "publish",

  /** Webhook event processing queue */
  WEBHOOK_PROCESSING: "webhook-processing",

  /** Webhook dead-letter queue for permanently failed webhook jobs */
  WEBHOOK_DEAD_LETTER: "webhook-dead-letter",

  /** General-purpose dead-letter queue for failed operations */
  DEAD_LETTER_QUEUE: "dead-letter-queue",

  /** Domain integration events (CQRS / event-driven) */
  INTEGRATION_EVENTS: "integration-events",

  /** Circuit-breaker dead-letter queue for failed external API calls */
  FAILED_OPERATIONS_DLQ: "failed-operations-dlq",

  /** Analytics aggregation queue (daily/monthly rollup + raw data purge) */
  ANALYTICS_AGGREGATION: "analytics-aggregation",

  /** Scheduled report generation queue (cron-driven + manual trigger) */
  REPORT_GENERATION: "report-generation",

  /** Recurring post scheduling queue (cron-driven post creation from templates) */
  RECURRING_POSTS: "recurring-posts",

  /** Inbox sync queue (polling provider comments every 30 minutes) */
  INBOX_SYNC: "inbox-sync",

  /** Detect high-performing posts for repurposing */
  DETECT_REPURPOSE: "detect-repurpose",

  /** Generate platform variants for repurpose proposals */
  GENERATE_REPURPOSE: "generate-repurpose",

  /** AI triage for incoming inbox messages */
  TRIAGE_INBOX: "triage-inbox",

  /** Trend radar — fetch and score trending topics */
  TREND_RADAR: "trend-radar",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
