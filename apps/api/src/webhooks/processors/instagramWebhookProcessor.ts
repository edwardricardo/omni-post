/**
 * @file instagramWebhookProcessor.ts
 * @description Instagram webhook processor handling Business Discovery API webhooks
 *              for media published/updated, comment events, and story mentions.
 * @layer infrastructure
 */
import type { WebhookEventType } from "@infra/prisma";
import type { ProviderName } from "@shared/types";
import { prisma } from "@infra/prisma";
import { webhookLogger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors/AppError.js";
import { AbstractWebhookProcessor } from "./AbstractWebhookProcessor.js";

/**
 * Instagram/Facebook Webhook Processor
 * Handles webhooks from Instagram Business Discovery API and Facebook Graph API
 *
 * Inherits HMAC-SHA256 signature verification from AbstractWebhookProcessor.
 *
 * Instagram webhook events include:
 * - Media published/updated
 * - Comments and mentions
 * - Story updates
 * - Account changes
 */
export class InstagramWebhookProcessor extends AbstractWebhookProcessor {
  protected override providerId: ProviderName = "INSTAGRAM";
  protected override signaturePrefix = "sha256=";
  protected override signatureEncoding: "hex" | "base64" = "hex";

  /**
   * Parse Instagram webhook payload and normalize data
   */
  override async parse(payload: Record<string, unknown>): Promise<{
    eventType: WebhookEventType;
    normalizedData: Record<string, unknown>;
    relatedEntities: {
      accountId?: string;
      projectId?: string;
      postId?: string;
      channelId?: string;
    };
  }> {
    const entryArr = payload.entry as Record<string, unknown>[] | undefined;
    const entry = entryArr?.[0];
    if (!entry) {
      throw AppError.badRequest("Invalid Instagram webhook payload: missing entry");
    }

    // Determine event type based on payload structure
    let eventType: WebhookEventType;
    let normalizedData: Record<string, unknown> = {};

    const changesArr = entry.changes as Record<string, unknown>[] | undefined;
    const messagingArr = entry.messaging as Record<string, unknown>[] | undefined;

    if (changesArr) {
      // Handle field changes (media updates, comments, etc.)
      const change = changesArr[0] as Record<string, unknown>;
      const field = change.field;
      const changeValue = (change.value ?? {}) as Record<string, unknown>;

      switch (field) {
        case "media":
          eventType = "POST_PUBLISHED";
          normalizedData = await this.parseMediaEvent(changeValue);
          break;

        case "comments":
          eventType = "COMMENT_RECEIVED";
          normalizedData = await this.parseCommentEvent(changeValue);
          break;

        case "mentions":
          eventType = "MENTION_RECEIVED";
          normalizedData = await this.parseMentionEvent(changeValue);
          break;

        case "story_insights":
          eventType = "STORY_EXPIRED";
          normalizedData = await this.parseStoryEvent(changeValue);
          break;

        default:
          eventType = "POST_UPDATED";
          normalizedData = { field, value: change.value };
      }
    } else if (messagingArr) {
      // Handle direct messages (for Instagram Business accounts)
      eventType = "COMMENT_RECEIVED";
      normalizedData = await this.parseMessagingEvent(messagingArr[0] as Record<string, unknown>);
    } else {
      throw AppError.badRequest(
        `Unsupported Instagram webhook event type: ${JSON.stringify(entry)}`
      );
    }

    // Find related entities based on Instagram page/account ID
    const relatedEntities = await this.findRelatedEntities(entry.id as string, normalizedData);

    return {
      eventType,
      normalizedData,
      relatedEntities,
    };
  }

  /**
   * Process the normalized webhook event
   */
  override async process(
    normalizedData: Record<string, unknown>,
    relatedEntities: Record<string, unknown>
  ): Promise<void> {
    const { accountId, projectId, postId: _postId, channelId: _channelId } = relatedEntities;

    if (!accountId && !projectId) {
      webhookLogger.warn(
        { provider: "INSTAGRAM" },
        "No related account or project found for webhook event"
      );
      return;
    }

    switch (normalizedData.eventType) {
      case "media_published":
        await this.handleMediaPublished(normalizedData, relatedEntities);
        break;

      case "comment_received":
        await this.handleCommentReceived(normalizedData, relatedEntities);
        break;

      case "mention_received":
        await this.handleMentionReceived(normalizedData, relatedEntities);
        break;

      case "story_expired":
        await this.handleStoryExpired(normalizedData, relatedEntities);
        break;

      case "engagement_update":
        await this.handleEngagementUpdate(normalizedData, relatedEntities);
        break;

      default:
        webhookLogger.warn(
          { provider: "INSTAGRAM", eventType: normalizedData.eventType },
          "Unknown Instagram event type"
        );
    }
  }

  /**
   * Parse media publication/update events
   */
  private async parseMediaEvent(value: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      eventType: "media_published",
      mediaId: value.id,
      mediaType: value.media_type, // IMAGE, VIDEO, CAROUSEL_ALBUM
      caption: value.caption,
      mediaUrl: value.media_url,
      permalink: value.permalink,
      timestamp: value.timestamp,
      username: value.username,
      isStory: value.media_type === "STORY",
    };
  }

  /**
   * Parse comment events
   */
  private async parseCommentEvent(
    value: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const media = value.media as Record<string, unknown> | undefined;
    const from = value.from as Record<string, unknown> | undefined;
    return {
      eventType: "comment_received",
      commentId: value.id,
      mediaId: media?.id,
      text: value.text,
      username: from?.username,
      userId: from?.id,
      timestamp: value.created_time,
      parentId: value.parent_id,
      isReply: !!value.parent_id,
    };
  }

  /**
   * Parse mention events
   */
  private async parseMentionEvent(
    value: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const from = value.from as Record<string, unknown> | undefined;
    return {
      eventType: "mention_received",
      mediaId: value.media_id,
      commentId: value.comment_id,
      text: value.text,
      username: from?.username,
      userId: from?.id,
      timestamp: value.created_time,
    };
  }

  /**
   * Parse story events
   */
  private async parseStoryEvent(value: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      eventType: "story_expired",
      storyId: value.id,
      mediaType: value.media_type,
      timestamp: value.timestamp,
      insights: value.insights || {},
      expirationTime: value.expiration_time,
    };
  }

  /**
   * Parse messaging events (Instagram Business)
   */
  private async parseMessagingEvent(
    messaging: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const sender = messaging.sender as Record<string, unknown> | undefined;
    const recipient = messaging.recipient as Record<string, unknown> | undefined;
    return {
      eventType: "comment_received",
      senderId: sender?.id,
      recipientId: recipient?.id,
      timestamp: messaging.timestamp,
      message: messaging.message,
      isDirectMessage: true,
    };
  }

  /**
   * Find related database entities based on Instagram page ID
   */
  private async findRelatedEntities(
    instagramPageId: string,
    normalizedData: Record<string, unknown>
  ) {
    // Find channel by Instagram page ID via the dedicated `providerAccountId`
    // column (no decryption needed for the lookup).
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "INSTAGRAM",
        providerAccountId: instagramPageId,
      },
      include: {
        project: {
          include: {
            account: true,
          },
        },
      },
    });

    if (!channel) {
      return {};
    }

    let postId: string | undefined;

    // Try to find related post if we have media ID
    if (normalizedData.mediaId) {
      const publishLog = await prisma.publishLog.findFirst({
        where: {
          channelId: channel.id,
          provider: "INSTAGRAM",
          // Look for Instagram media ID in payload
          payload: {
            path: ["instagram_media_id"],
            equals: normalizedData.mediaId,
          },
        },
      });

      postId = publishLog?.postId || undefined;
    }

    return {
      accountId: channel.project.accountId,
      projectId: channel.projectId,
      channelId: channel.id,
      ...(postId && { postId }),
    };
  }

  /**
   * Handle media published event
   */
  private async handleMediaPublished(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const postId = entities.postId as string | undefined;
    const channelId = entities.channelId as string | undefined;

    if (postId && channelId) {
      // Update publish log with Instagram media ID
      await prisma.publishLog.updateMany({
        where: {
          postId,
          channelId,
          provider: "INSTAGRAM",
        },
        data: {
          status: "OK",
          payload: {
            instagram_media_id: String(data.mediaId ?? ""),
            media_type: String(data.mediaType ?? ""),
            permalink: String(data.permalink ?? ""),
            webhook_received_at: new Date().toISOString(),
          },
        },
      });

      // Update post status
      await prisma.post.update({
        where: { id: postId },
        data: { status: "PUBLISHED" },
      });

      // Broadcast real-time post status update
      if (this.broadcaster) {
        await this.broadcaster.broadcastPostStatusChange(postId, "PUBLISHED", "INSTAGRAM", {
          instagram_media_id: data.mediaId,
          media_type: data.mediaType,
          permalink: data.permalink,
        });
      }
    }

    // Store Instagram analytics if available
    if (entities.accountId && entities.projectId) {
      await prisma.instagramAnalytics.create({
        data: {
          accountId: entities.accountId as string,
          projectId: entities.projectId as string,
          contentType: data.isStory
            ? "STORIES"
            : data.mediaType === "CAROUSEL_ALBUM"
              ? "CAROUSEL"
              : "FEED",
          contentId: String(data.mediaId ?? ""),
          instagramId: String(data.mediaId ?? "") || null,
          capturedAt: new Date(data.timestamp as string | number),
        },
      });
    }
  }

  /**
   * Handle comment received event
   */
  private async handleCommentReceived(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    // Create analytics entry for comment engagement
    if (entities.accountId && entities.projectId && data.mediaId) {
      // Find existing analytics record and increment comments
      const existing = await prisma.instagramAnalytics.findFirst({
        where: {
          accountId: entities.accountId as string,
          projectId: entities.projectId as string,
          instagramId: data.mediaId as string,
        },
      });

      if (existing) {
        await prisma.instagramAnalytics.update({
          where: { id: existing.id },
          data: {
            comments: { increment: 1 },
            capturedAt: new Date(),
          },
        });

        // Broadcast real-time engagement update
        if (this.broadcaster) {
          await this.broadcaster.broadcastEngagementUpdate(
            (entities.postId || data.mediaId) as string,
            "INSTAGRAM",
            { comments: existing.comments + 1 },
            { comments: 1 }
          );
        }
      }
    }

    // Future: comment notifications, automated moderation, analytics storage
  }

  /**
   * Handle mention received event
   */
  private async handleMentionReceived(
    data: Record<string, unknown>,
    _entities: Record<string, unknown>
  ): Promise<void> {
    // Future: mention tracking, notifications, and brand monitoring analytics
    webhookLogger.info({ provider: "INSTAGRAM", mention: data }, "Instagram mention received");
  }

  /**
   * Handle story expired event
   */
  private async handleStoryExpired(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    if (entities.accountId && entities.projectId) {
      const insights = (data.insights ?? {}) as Record<string, unknown>;
      // Build update data from insights - only include serializable values
      const updatePayload: Record<string, unknown> = {
        capturedAt: new Date(),
      };
      for (const [key, val] of Object.entries(insights)) {
        if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
          updatePayload[key] = val;
        }
      }
      // Update story analytics with final insights
      await prisma.instagramAnalytics.updateMany({
        where: {
          accountId: entities.accountId as string,
          projectId: entities.projectId as string,
          contentType: "STORIES",
          instagramId: data.storyId as string,
        },
        data: updatePayload,
      });
    }
  }

  /**
   * Handle engagement updates (likes, shares, etc.)
   */
  private async handleEngagementUpdate(
    _data: Record<string, unknown>,
    _entities: Record<string, unknown>
  ): Promise<void> {
    // Future: real-time engagement tracking, analytics updates, milestone notifications
  }
}
