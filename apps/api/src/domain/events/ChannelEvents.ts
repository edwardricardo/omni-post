/**
 * @file ChannelEvents.ts
 * @description Domain events emitted by the Channel lifecycle. Currently
 *              covers the auth-failure detection path used by sync workers
 *              when a provider rejects credentials (token expired, scope
 *              revoked, account suspended). Consumers downstream (notification
 *              handler, dashboard widgets) react to this event to surface
 *              the issue to the user.
 * @layer domain
 */

import { BaseDomainEvent } from "./DomainEvent.js";

/**
 * Emitted when a sync worker detects that a channel's stored credentials
 * are no longer valid. The originating worker (inbox-sync, analytics-ingest)
 * persists the channel's `needsReauth = true` state in the same transaction
 * as this event, so the outbox guarantees the user-facing notification (when
 * wired) follows the state change.
 */
export class ChannelAuthFailed extends BaseDomainEvent {
  readonly eventType = "ChannelAuthFailed";
  readonly aggregateType = "Channel";

  constructor(
    readonly aggregateId: string,
    readonly provider: string,
    readonly reason: string,
    readonly detectedAt: Date,
    metadata?: Record<string, unknown>
  ) {
    super(1, metadata);
  }

  toPayload(): Record<string, unknown> {
    return {
      channelId: this.aggregateId,
      provider: this.provider,
      reason: this.reason,
      detectedAt: this.detectedAt.toISOString(),
    };
  }
}
