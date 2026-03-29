/**
 * @file TriggerIntegrationEventService.ts
 * @description Service that fires webhook payloads to all active integration subscriptions
 *   for a given event type. Supports platform-specific filtering. Fire-and-forget:
 *   logs errors but never throws.
 * @layer application
 */

import type { IntegrationSubscriptionRepository } from "../../domain/repositories/IntegrationSubscriptionRepository.js";
import type { IntegrationPlatformValue } from "../../domain/entities/IntegrationApiKey.js";

/**
 * @class TriggerIntegrationEventService
 * @description Finds active subscriptions for an event and POSTs the payload
 *   to each target URL. Errors are logged but do not propagate.
 */
export class TriggerIntegrationEventService {
  constructor(private readonly repository: IntegrationSubscriptionRepository) {}

  /**
   * @method fire
   * @description Delivers a webhook payload to all active subscribers for the event.
   *   When platform is specified, only subscribers of that platform receive the event.
   * @param event - The event type (e.g., "post.published")
   * @param payload - The JSON-serializable payload to send
   * @param platform - Optional platform filter (e.g., "ZAPIER", "MAKE")
   */
  async fire(
    event: string,
    payload: Record<string, unknown>,
    platform?: IntegrationPlatformValue
  ): Promise<void> {
    let subscriptions;
    try {
      if (platform) {
        subscriptions = await this.repository.findActiveByEventAndPlatform(event, platform);
      } else {
        subscriptions = await this.repository.findActiveByEvent(event);
      }
    } catch {
      // Cannot load subscriptions -- silently skip
      return;
    }

    if (subscriptions.length === 0) {
      return;
    }

    const body = JSON.stringify({ event, data: payload, firedAt: new Date().toISOString() });

    const deliveries = subscriptions.map(async (sub) => {
      try {
        await fetch(sub.targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // Fire-and-forget: errors are silently consumed
      }
    });

    await Promise.allSettled(deliveries);
  }
}
