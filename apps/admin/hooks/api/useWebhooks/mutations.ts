/**
 * @file mutations.ts
 * @description Mutation hooks for the webhooks dashboard — subscriptions
 *              CRUD, webhook DLQ retry (single + all), event export, and
 *              outbox DLQ retry/resolve. Each mutation invalidates the
 *              broadest reasonable key family on success.
 *
 *              Errors propagate to the global `MutationCache.onError`
 *              handler wired in `createAppQueryClient` (T3-A) for logging.
 *              Consumers can pass per-call `onSuccess`/`onError` via
 *              `mutate(..., { onSuccess, onError })` for UI feedback.
 * @layer infrastructure
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  exportWebhookEvents,
  resolveOutboxDeadLetter,
  retryAllWebhookDeadLetter,
  retryOutboxDeadLetter,
  retryWebhookDeadLetter,
  updateWebhookSubscription,
} from "./api";

const WEBHOOKS_KEY = ["webhooks"] as const;
const OUTBOX_KEY = ["outbox"] as const;

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * @hook useCreateWebhookSubscription
 * @description Mutation that creates a new webhook subscription for a provider.
 *   Invalidates `["webhooks"]` family on success.
 */
export function useCreateWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createWebhookSubscription,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WEBHOOKS_KEY });
    },
  });
}

/**
 * @hook useUpdateWebhookSubscription
 * @description Mutation that updates a subscription (toggle active, change events, etc.).
 *   Invalidates `["webhooks"]` family on success.
 */
export function useUpdateWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateWebhookSubscription,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WEBHOOKS_KEY });
    },
  });
}

/**
 * @hook useDeleteWebhookSubscription
 * @description Mutation that deletes a webhook subscription by id.
 *   Invalidates `["webhooks"]` family on success.
 */
export function useDeleteWebhookSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteWebhookSubscription,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WEBHOOKS_KEY });
    },
  });
}

// ---------------------------------------------------------------------------
// Webhook DLQ
// ---------------------------------------------------------------------------

/**
 * @hook useRetryWebhookDeadLetter
 * @description Mutation that retries a single webhook DLQ event.
 *   Invalidates `["webhooks"]` family on success so DLQ list + metrics refresh.
 */
export function useRetryWebhookDeadLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: retryWebhookDeadLetter,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WEBHOOKS_KEY });
    },
  });
}

/**
 * @hook useRetryAllWebhookDeadLetter
 * @description Mutation that retries every event in the webhook DLQ.
 *   Invalidates `["webhooks"]` family on success.
 */
export function useRetryAllWebhookDeadLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: retryAllWebhookDeadLetter,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WEBHOOKS_KEY });
    },
  });
}

// ---------------------------------------------------------------------------
// Events export
// ---------------------------------------------------------------------------

/**
 * @hook useExportWebhookEvents
 * @description Mutation that downloads a CSV blob of webhook events with the
 *   given filters. Does NOT invalidate cache (read-only effect — no state change).
 *   Consumer is responsible for triggering the browser download via the returned blob.
 */
export function useExportWebhookEvents() {
  return useMutation({
    mutationFn: exportWebhookEvents,
  });
}

// ---------------------------------------------------------------------------
// Outbox DLQ
// ---------------------------------------------------------------------------

/**
 * @hook useRetryOutboxDlq
 * @description Mutation that retries an outbox dead-letter entry by ID.
 * @returns Mutation object with mutate(id) and status fields
 */
export function useRetryOutboxDlq() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: retryOutboxDeadLetter,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTBOX_KEY });
    },
  });
}

/**
 * @hook useResolveOutboxDlq
 * @description Mutation that resolves an outbox dead-letter entry by ID.
 * @returns Mutation object with mutate(id) and status fields
 */
export function useResolveOutboxDlq() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resolveOutboxDeadLetter,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTBOX_KEY });
    },
  });
}
