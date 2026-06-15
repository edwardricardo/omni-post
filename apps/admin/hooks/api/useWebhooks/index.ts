/**
 * @file index.ts
 * @description Barrel export for the webhooks hook module — preserves the
 *              public import path `@/hooks/api/useWebhooks` after the file
 *              split into types/api/queries/mutations.
 * @layer infrastructure
 */

export type { DeadLetterEvent, WebhookEvent, WebhookSubscription } from "./types.js";

export {
  useDlqMetrics,
  useOutboxDeadLetter,
  useProjectsForSubscriptionForm,
  useWebhookDeadLetterEvents,
  useWebhookEventDetail,
  useWebhookEvents,
  useWebhookMetrics,
  useWebhookSubscriptions,
} from "./queries.js";

export {
  useCreateWebhookSubscription,
  useDeleteWebhookSubscription,
  useExportWebhookEvents,
  useResolveOutboxDlq,
  useRetryAllWebhookDeadLetter,
  useRetryOutboxDlq,
  useRetryWebhookDeadLetter,
  useUpdateWebhookSubscription,
} from "./mutations.js";
