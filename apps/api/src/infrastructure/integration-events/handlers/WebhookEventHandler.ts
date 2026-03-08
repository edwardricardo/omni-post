/**
 * Infrastructure Layer - Webhook Integration Event Handler
 *
 * Part of P2-2: Integration Events via BullMQ
 * Stub handler for webhook delivery events.
 *
 * Current state: no-op stub. Real implementation will enqueue webhook
 * delivery jobs so external consumers (subscribed via the webhooks API)
 * receive notifications for post lifecycle events.
 *
 * Handles:
 *   - PostPublished       — a post was successfully published to a provider
 *   - PostPublishingFailed — a post failed to publish after all retries
 *   - PostScheduled       — a post was scheduled for future publication
 *   - PostCancelled       — a scheduled post was cancelled
 */

import type { IntegrationEvent } from "../IntegrationEvent.js";
import type { IntegrationEventHandler } from "../IntegrationEventHandler.js";

/**
 * Handles webhook delivery for post lifecycle integration events.
 *
 * Receives post state-change events and will eventually enqueue delivery
 * jobs to the webhook system for registered external consumers. As a stub,
 * this is a safe no-op.
 */
export class WebhookEventHandler implements IntegrationEventHandler {
  /**
   * Event types handled by this handler.
   * Covers the full lifecycle that external webhook consumers care about.
   */
  readonly eventTypes = [
    "PostPublished",
    "PostPublishingFailed",
    "PostScheduled",
    "PostCancelled",
  ] as const;

  /**
   * Handle a webhook-delivery integration event.
   *
   * Stub implementation — no-op. In production this will:
   * 1. Look up subscribed webhook endpoints for the event type and account
   * 2. Enqueue a webhook delivery job per endpoint (with retry/backoff)
   * 3. Track delivery status for the webhook dashboard
   *
   * @param _event - The integration event (unused in stub)
   */
  async handle(_event: IntegrationEvent): Promise<void> {
    // Stub: intentional no-op. Future implementation will enqueue webhook deliveries.
  }
}
