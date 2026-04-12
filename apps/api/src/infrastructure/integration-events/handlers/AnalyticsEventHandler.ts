/**
 * @file AnalyticsEventHandler.ts
 * @description Stub handler for analytics-related integration events (PostCreated,
 *              PostPublished, PostPublishingFailed). Will forward to analytics pipeline.
 * @layer infrastructure
 */

import type { IntegrationEvent } from "../IntegrationEvent.js";
import type { IntegrationEventHandler } from "../IntegrationEventHandler.js";

/**
 * Handles analytics-related integration events.
 *
 * Receives post lifecycle events and will eventually forward them to
 * the analytics ingestion pipeline. As a stub, this is a safe no-op.
 */
export class AnalyticsEventHandler implements IntegrationEventHandler {
  /**
   * Event types handled by this handler.
   * All three cover the full post creation-to-publication lifecycle.
   */
  readonly eventTypes = ["PostCreated", "PostPublished", "PostPublishingFailed"] as const;

  /**
   * Handle an analytics-relevant integration event.
   *
   * Stub implementation — no-op. In production this will:
   * 1. Increment Prometheus counters (postsCreated, postsPublished, publishFailures)
   * 2. Forward to analytics event store for BI dashboards
   * 3. Trigger trend recalculation for affected channels
   *
   * @param _event - The integration event (unused in stub)
   */
  async handle(_event: IntegrationEvent): Promise<void> {
    // Stub: intentional no-op. Future implementation will forward to analytics pipeline.
  }
}
