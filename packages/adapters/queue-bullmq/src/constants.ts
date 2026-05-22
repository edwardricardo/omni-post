/**
 * @file constants.ts
 * @description Centralized BullMQ queue name constants preventing name mismatches across
 *              producers, consumers, and dashboards that share the same Redis key space.
 * @layer infrastructure
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

  /** Mention ingest queue (brand-listening: search polling + webhook fetch) */
  MENTION_INGEST: "mention-ingest",

  /** Detect high-performing posts for repurposing */
  DETECT_REPURPOSE: "detect-repurpose",

  /** Generate platform variants for repurpose proposals */
  GENERATE_REPURPOSE: "generate-repurpose",

  /** AI triage for incoming inbox messages */
  TRIAGE_INBOX: "triage-inbox",

  /** Trend radar — fetch and score trending topics */
  TREND_RADAR: "trend-radar",

  /** Auto-renewal — convert expired trials to paid subscriptions (daily cron) */
  AUTO_RENEWAL: "auto-renewal",

  /** Gateway switch — reminder + suspend jobs for gateway transitions */
  GATEWAY_SWITCH: "gateway-switch",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
