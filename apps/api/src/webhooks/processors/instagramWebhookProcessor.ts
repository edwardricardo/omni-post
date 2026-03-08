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
  override async parse(payload: Record<string, any>): Promise<{
    eventType: WebhookEventType;
    normalizedData: Record<string, any>;
    relatedEntities: {
      accountId?: string;
      projectId?: string;
      postId?: string;
      channelId?: string;
    };
  }> {
    const entry = payload.entry?.[0];
    if (!entry) {
      throw AppError.badRequest("Invalid Instagram webhook payload: missing entry");
    }

    // Determine event type based on payload structure
    let eventType: WebhookEventType;
    let normalizedData: Record<string, any> = {};
    let relatedEntities: any = {};

    if (entry.changes) {
      // Handle field changes (media updates, comments, etc.)
      const change = entry.changes[0];
      const field = change.field;

      switch (field) {
        case "media":
          eventType = "POST_PUBLISHED";
          normalizedData = await this.parseMediaEvent(change.value);
          break;

        case "comments":
          eventType = "COMMENT_RECEIVED";
          normalizedData = await this.parseCommentEvent(change.value);
          break;

        case "mentions":
          eventType = "MENTION_RECEIVED";
          normalizedData = await this.parseMentionEvent(change.value);
          break;

        case "story_insights":
          eventType = "STORY_EXPIRED";
          normalizedData = await this.parseStoryEvent(change.value);
          break;

        default:
          eventType = "POST_UPDATED";
          normalizedData = { field, value: change.value };
      }
    } else if (entry.messaging) {
      // Handle direct messages (for Instagram Business accounts)
      eventType = "COMMENT_RECEIVED";
      normalizedData = await this.parseMessagingEvent(entry.messaging[0]);
    } else {
      throw AppError.badRequest(
        `Unsupported Instagram webhook event type: ${JSON.stringify(entry)}`
      );
    }

    // Find related entities based on Instagram page/account ID
    relatedEntities = await this.findRelatedEntities(entry.id, normalizedData);

    return {
      eventType,
      normalizedData,
      relatedEntities,
    };
  }

  /**
   * Process the normalized webhook event
   */
  override async process(normalizedData: Record<string, any>, relatedEntities: any): Promise<void> {
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
  private async parseMediaEvent(value: any): Promise<Record<string, any>> {
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
  private async parseCommentEvent(value: any): Promise<Record<string, any>> {
    return {
      eventType: "comment_received",
      commentId: value.id,
      mediaId: value.media?.id,
      text: value.text,
      username: value.from?.username,
      userId: value.from?.id,
      timestamp: value.created_time,
      parentId: value.parent_id,
      isReply: !!value.parent_id,
    };
  }

  /**
   * Parse mention events
   */
  private async parseMentionEvent(value: any): Promise<Record<string, any>> {
    return {
      eventType: "mention_received",
      mediaId: value.media_id,
      commentId: value.comment_id,
      text: value.text,
      username: value.from?.username,
      userId: value.from?.id,
      timestamp: value.created_time,
    };
  }

  /**
   * Parse story events
   */
  private async parseStoryEvent(value: any): Promise<Record<string, any>> {
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
  private async parseMessagingEvent(messaging: any): Promise<Record<string, any>> {
    return {
      eventType: "comment_received",
      senderId: messaging.sender?.id,
      recipientId: messaging.recipient?.id,
      timestamp: messaging.timestamp,
      message: messaging.message,
      isDirectMessage: true,
    };
  }

  /**
   * Find related database entities based on Instagram page ID
   */
  private async findRelatedEntities(instagramPageId: string, normalizedData: Record<string, any>) {
    // Find channel by Instagram page ID
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "INSTAGRAM",
        // Look for Instagram page ID in credentials
        credentials: {
          path: ["page_id"],
          equals: instagramPageId,
        },
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
  private async handleMediaPublished(data: Record<string, any>, entities: any): Promise<void> {
    const { postId, channelId } = entities;

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
            instagram_media_id: data.mediaId,
            media_type: data.mediaType,
            permalink: data.permalink,
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
          accountId: entities.accountId,
          projectId: entities.projectId,
          contentType: data.isStory
            ? "STORIES"
            : data.mediaType === "CAROUSEL_ALBUM"
              ? "CAROUSEL"
              : "FEED",
          contentId: data.mediaId,
          instagramId: data.mediaId,
          capturedAt: new Date(data.timestamp),
        },
      });
    }
  }

  /**
   * Handle comment received event
   */
  private async handleCommentReceived(data: Record<string, any>, entities: any): Promise<void> {
    // Create analytics entry for comment engagement
    if (entities.accountId && entities.projectId && data.mediaId) {
      // Find existing analytics record and increment comments
      const existing = await prisma.instagramAnalytics.findFirst({
        where: {
          accountId: entities.accountId,
          projectId: entities.projectId,
          instagramId: data.mediaId,
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
            entities.postId || data.mediaId,
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
  private async handleMentionReceived(data: Record<string, any>, _entities: any): Promise<void> {
    // Future: mention tracking, notifications, and brand monitoring analytics
    webhookLogger.info({ provider: "INSTAGRAM", mention: data }, "Instagram mention received");
  }

  /**
   * Handle story expired event
   */
  private async handleStoryExpired(data: Record<string, any>, entities: any): Promise<void> {
    if (entities.accountId && entities.projectId) {
      // Update story analytics with final insights
      await prisma.instagramAnalytics.updateMany({
        where: {
          accountId: entities.accountId,
          projectId: entities.projectId,
          contentType: "STORIES",
          instagramId: data.storyId,
        },
        data: {
          // Update with final story metrics
          ...data.insights,
          capturedAt: new Date(),
        },
      });
    }
  }

  /**
   * Handle engagement updates (likes, shares, etc.)
   */
  private async handleEngagementUpdate(_data: Record<string, any>, _entities: any): Promise<void> {
    // Future: real-time engagement tracking, analytics updates, milestone notifications
  }
}
