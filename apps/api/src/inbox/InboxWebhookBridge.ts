/**
 * @file InboxWebhookBridge.ts
 * @description Bridges webhook processor events to the Social Inbox ingestion pipeline.
 *   Listens for COMMENT_RECEIVED and MENTION_RECEIVED webhook events and creates
 *   corresponding SocialMessage entries via IngestSocialMessageUseCase.
 * @layer infrastructure
 */

import { type IngestSocialMessageUseCase } from "../application/inbox/IngestSocialMessageUseCase.js";
import { type ProviderType } from "../domain/value-objects/Provider.js";

/**
 * Normalized webhook event data expected by the bridge.
 */
export interface WebhookBridgeEvent {
  accountId: string;
  projectId: string;
  channelId: string;
  provider: ProviderType;
  eventType: string;
  webhookEventId: string;
  providerMessageId: string;
  providerParentId?: string;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorProviderId: string;
  body: string;
  mediaUrls?: string[];
  relatedPostId?: string;
  providerCreatedAt: Date;
}

const INBOX_EVENT_TYPES = new Set(["COMMENT_RECEIVED", "MENTION_RECEIVED"]);

/**
 * @class InboxWebhookBridge
 * @description Connects the webhook processing pipeline to the Social Inbox.
 *   Registered as an integration event handler. When a COMMENT_RECEIVED or
 *   MENTION_RECEIVED event is processed, it translates to IngestSocialMessageUseCase.
 */
export class InboxWebhookBridge {
  constructor(private readonly ingestUseCase: IngestSocialMessageUseCase) {}

  /**
   * @method shouldHandle
   * @description Check if this bridge should handle the given event type.
   * @param eventType - The webhook event type
   * @returns true if the event should be processed by the inbox
   */
  shouldHandle(eventType: string): boolean {
    return INBOX_EVENT_TYPES.has(eventType);
  }

  /**
   * @method handle
   * @description Process a webhook event and ingest it as a social message.
   * @param event - The normalized webhook event data
   * @returns The ingested message ID, or null if skipped (dedup)
   */
  async handle(event: WebhookBridgeEvent): Promise<string | null> {
    if (!this.shouldHandle(event.eventType)) {
      return null;
    }

    const messageType = event.eventType === "MENTION_RECEIVED" ? "MENTION" : "COMMENT";

    const result = await this.ingestUseCase.execute({
      accountId: event.accountId,
      projectId: event.projectId,
      channelId: event.channelId,
      provider: event.provider,
      providerMessageId: event.providerMessageId,
      ...(event.providerParentId !== undefined && { providerParentId: event.providerParentId }),
      messageType,
      authorName: event.authorName,
      ...(event.authorHandle !== undefined && { authorHandle: event.authorHandle }),
      ...(event.authorAvatarUrl !== undefined && { authorAvatarUrl: event.authorAvatarUrl }),
      authorProviderId: event.authorProviderId,
      body: event.body,
      ...(event.mediaUrls !== undefined &&
        event.mediaUrls.length > 0 && {
          mediaUrls: event.mediaUrls,
        }),
      webhookEventId: event.webhookEventId,
      ...(event.relatedPostId !== undefined && { relatedPostId: event.relatedPostId }),
      providerCreatedAt: event.providerCreatedAt,
    });

    if (!result.ok) {
      return null;
    }

    return result.value.id;
  }
}
