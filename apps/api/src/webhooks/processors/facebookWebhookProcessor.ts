import type { WebhookEventType } from "@infra/prisma";
import type { ProviderName } from "@shared/types";
import { prisma } from "@infra/prisma";
import { webhookLogger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors/AppError.js";
import { AbstractWebhookProcessor } from "./AbstractWebhookProcessor.js";

/**
 * Facebook Webhook Processor
 * Handles webhooks from Facebook Graph API
 *
 * Inherits HMAC-SHA256 signature verification from AbstractWebhookProcessor.
 *
 * Facebook webhook events include:
 * - Feed updates (post published/updated)
 * - Comment events (comments, replies)
 * - Reaction events (likes, reactions)
 * - Page events (page updates, mentions)
 */
export class FacebookWebhookProcessor extends AbstractWebhookProcessor {
  protected override providerId: ProviderName = "FACEBOOK";
  protected override signaturePrefix = "sha256=";
  protected override signatureEncoding: "hex" | "base64" = "hex";

  /**
   * Parse Facebook webhook payload and normalize data
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
      throw AppError.badRequest("Invalid Facebook webhook payload: missing entry");
    }

    // Determine event type based on payload structure
    let eventType: WebhookEventType;
    let normalizedData: Record<string, any> = {};
    let relatedEntities: any = {};

    if (entry.changes) {
      // Handle field changes (feed updates, comments, reactions, etc.)
      const change = entry.changes[0];
      const field = change.field;

      switch (field) {
        case "feed":
          eventType = "POST_PUBLISHED";
          normalizedData = await this.parseFeedEvent(change.value);
          break;

        case "comments":
          eventType = "COMMENT_RECEIVED";
          normalizedData = await this.parseCommentEvent(change.value);
          break;

        case "reactions":
          eventType = "LIKE_RECEIVED";
          normalizedData = await this.parseReactionEvent(change.value);
          break;

        case "mention":
        case "mentions":
          eventType = "MENTION_RECEIVED";
          normalizedData = await this.parseMentionEvent(change.value);
          break;

        case "page":
          eventType = "ACCOUNT_CONNECTED";
          normalizedData = await this.parsePageEvent(change.value);
          break;

        case "live_videos":
          eventType = "POST_PUBLISHED";
          normalizedData = await this.parseLiveVideoEvent(change.value);
          break;

        default:
          eventType = "POST_UPDATED";
          normalizedData = { field, value: change.value };
      }
    } else if (entry.messaging) {
      // Handle Facebook Messenger messages
      eventType = "COMMENT_RECEIVED";
      normalizedData = await this.parseMessagingEvent(entry.messaging[0]);
    } else {
      throw AppError.badRequest(
        `Unsupported Facebook webhook event type: ${JSON.stringify(entry)}`
      );
    }

    // Find related entities based on Facebook page ID
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
        { provider: "FACEBOOK" },
        "No related account or project found for webhook event"
      );
      return;
    }

    switch (normalizedData.eventType) {
      case "feed_published":
        await this.handleFeedPublished(normalizedData, relatedEntities);
        break;

      case "comment_received":
        await this.handleCommentReceived(normalizedData, relatedEntities);
        break;

      case "reaction_received":
        await this.handleReactionReceived(normalizedData, relatedEntities);
        break;

      case "mention_received":
        await this.handleMentionReceived(normalizedData, relatedEntities);
        break;

      case "page_updated":
        await this.handlePageUpdated(normalizedData, relatedEntities);
        break;

      case "live_video_published":
        await this.handleLiveVideoPublished(normalizedData, relatedEntities);
        break;

      case "engagement_update":
        await this.handleEngagementUpdate(normalizedData, relatedEntities);
        break;

      default:
        webhookLogger.warn(
          { provider: "FACEBOOK", eventType: normalizedData.eventType },
          "Unknown Facebook event type"
        );
    }
  }

  /**
   * Parse feed publication/update events
   */
  private async parseFeedEvent(value: any): Promise<Record<string, any>> {
    return {
      eventType: "feed_published",
      postId: value.post_id || value.id,
      verb: value.verb, // "add", "edited", "remove"
      item: value.item, // "status", "photo", "video", etc.
      message: value.message,
      link: value.link,
      permalink: value.permalink_url,
      createdTime: value.created_time,
      from: {
        id: value.from?.id,
        name: value.from?.name,
      },
      isPublished: value.published === true,
      isHidden: value.is_hidden === true,
    };
  }

  /**
   * Parse comment events
   */
  private async parseCommentEvent(value: any): Promise<Record<string, any>> {
    return {
      eventType: "comment_received",
      commentId: value.comment_id || value.id,
      postId: value.post_id || value.parent_id,
      text: value.message || value.text,
      from: {
        id: value.from?.id,
        name: value.from?.name,
      },
      createdTime: value.created_time,
      parentId: value.parent_id,
      verb: value.verb, // "add", "edited", "remove"
      isReply: !!value.parent_id && value.parent_id !== value.post_id,
    };
  }

  /**
   * Parse reaction events (likes, love, haha, wow, sad, angry)
   */
  private async parseReactionEvent(value: any): Promise<Record<string, any>> {
    return {
      eventType: "reaction_received",
      reactionId: value.reaction_id || value.id,
      postId: value.post_id || value.parent_id,
      reactionType: value.reaction_type || "like", // like, love, haha, wow, sad, angry
      from: {
        id: value.from?.id,
        name: value.from?.name,
      },
      createdTime: value.created_time,
      verb: value.verb, // "add", "remove"
    };
  }

  /**
   * Parse mention events
   */
  private async parseMentionEvent(value: any): Promise<Record<string, any>> {
    return {
      eventType: "mention_received",
      postId: value.post_id || value.id,
      message: value.message,
      from: {
        id: value.from?.id,
        name: value.from?.name,
      },
      createdTime: value.created_time,
      permalink: value.permalink_url,
    };
  }

  /**
   * Parse page events (page updates, settings changes)
   */
  private async parsePageEvent(value: any): Promise<Record<string, any>> {
    return {
      eventType: "page_updated",
      pageId: value.page_id || value.id,
      verb: value.verb, // "update"
      changes: value.changes || {},
      category: value.category,
      name: value.name,
    };
  }

  /**
   * Parse live video events
   */
  private async parseLiveVideoEvent(value: any): Promise<Record<string, any>> {
    return {
      eventType: "live_video_published",
      videoId: value.video_id || value.id,
      status: value.status, // "live", "vod", "processing"
      broadcastStartTime: value.broadcast_start_time,
      description: value.description,
      permalink: value.permalink_url,
      from: {
        id: value.from?.id,
        name: value.from?.name,
      },
    };
  }

  /**
   * Parse messaging events (Facebook Messenger)
   */
  private async parseMessagingEvent(messaging: any): Promise<Record<string, any>> {
    return {
      eventType: "comment_received",
      senderId: messaging.sender?.id,
      recipientId: messaging.recipient?.id,
      timestamp: messaging.timestamp,
      message: messaging.message,
      isDirectMessage: true,
      isMessenger: true,
    };
  }

  /**
   * Find related database entities based on Facebook page ID
   */
  private async findRelatedEntities(facebookPageId: string, normalizedData: Record<string, any>) {
    // Find channel by Facebook page ID
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "FACEBOOK",
        // Look for Facebook page ID in credentials
        credentials: {
          path: ["page_id"],
          equals: facebookPageId,
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

    // Try to find related post if we have Facebook post ID
    if (normalizedData.postId) {
      const publishLog = await prisma.publishLog.findFirst({
        where: {
          channelId: channel.id,
          provider: "FACEBOOK",
          // Look for Facebook post ID in payload
          payload: {
            path: ["facebook_post_id"],
            equals: normalizedData.postId,
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
   * Handle feed published event
   */
  private async handleFeedPublished(data: Record<string, any>, entities: any): Promise<void> {
    const { postId, channelId } = entities;

    if (postId && channelId) {
      // Update publish log with Facebook post ID
      await prisma.publishLog.updateMany({
        where: {
          postId,
          channelId,
          provider: "FACEBOOK",
        },
        data: {
          status: "OK",
          payload: {
            facebook_post_id: data.postId,
            item_type: data.item,
            permalink: data.permalink,
            is_published: data.isPublished,
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
        await this.broadcaster.broadcastPostStatusChange(postId, "PUBLISHED", "FACEBOOK", {
          facebook_post_id: data.postId,
          item_type: data.item,
          permalink: data.permalink,
        });
      }
    }

    // Store Facebook analytics if available
    if (entities.channelId && postId) {
      await prisma.analytics.create({
        data: {
          channelId: entities.channelId,
          provider: "FACEBOOK",
          postId,
          capturedAt: new Date(data.createdTime || new Date()),
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
        },
      });
    }
  }

  /**
   * Handle comment received event
   */
  private async handleCommentReceived(data: Record<string, any>, entities: any): Promise<void> {
    // Create analytics entry for comment engagement
    if (entities.channelId && entities.postId) {
      // Find existing analytics record and increment comments
      const existing = await prisma.analytics.findFirst({
        where: {
          channelId: entities.channelId,
          provider: "FACEBOOK",
          postId: entities.postId,
        },
      });

      if (existing) {
        const newCommentsCount = (existing.comments || 0) + 1;
        await prisma.analytics.update({
          where: { id: existing.id },
          data: {
            comments: newCommentsCount,
            capturedAt: new Date(),
          },
        });

        // Broadcast real-time engagement update
        if (this.broadcaster) {
          await this.broadcaster.broadcastEngagementUpdate(
            entities.postId,
            "FACEBOOK",
            { comments: newCommentsCount },
            { comments: 1 }
          );
        }
      }
    }

    // Future: comment notifications, automated moderation, analytics storage
  }

  /**
   * Handle reaction received event
   */
  private async handleReactionReceived(data: Record<string, any>, entities: any): Promise<void> {
    if (entities.channelId && entities.postId) {
      // Find existing analytics record and increment likes (reactions count as likes)
      const existing = await prisma.analytics.findFirst({
        where: {
          channelId: entities.channelId,
          provider: "FACEBOOK",
          postId: entities.postId,
        },
      });

      if (existing) {
        // All reactions count as "likes" in the generic analytics model
        const increment = data.verb === "add" ? 1 : -1;
        const newLikesCount = (existing.likes || 0) + increment;

        await prisma.analytics.update({
          where: { id: existing.id },
          data: {
            likes: newLikesCount,
            capturedAt: new Date(),
          },
        });

        // Broadcast real-time engagement update
        if (this.broadcaster) {
          await this.broadcaster.broadcastEngagementUpdate(
            entities.postId,
            "FACEBOOK",
            { likes: newLikesCount },
            { likes: increment }
          );
        }
      }
    }

    // Future: per-reaction-type tracking (love, wow, angry, etc.) in platform-specific field
  }

  /**
   * Handle mention received event
   */
  private async handleMentionReceived(data: Record<string, any>, _entities: any): Promise<void> {
    // Future: mention tracking, notifications, and brand monitoring analytics
    webhookLogger.info({ provider: "FACEBOOK", mention: data }, "Facebook mention received");
  }

  /**
   * Handle page updated event
   */
  private async handlePageUpdated(data: Record<string, any>, entities: any): Promise<void> {
    if (entities.channelId) {
      // Update channel with latest page information
      await prisma.channel.update({
        where: { id: entities.channelId },
        data: {
          credentials: {
            ...(data.changes || {}),
            last_page_update: new Date().toISOString(),
          },
        },
      });
    }

    // Future: page settings change notifications and analytics tracking
  }

  /**
   * Handle live video published event
   */
  private async handleLiveVideoPublished(data: Record<string, any>, entities: any): Promise<void> {
    if (entities.channelId && entities.postId) {
      // Create analytics entry for live video
      await prisma.analytics.create({
        data: {
          channelId: entities.channelId,
          provider: "FACEBOOK",
          postId: entities.postId,
          capturedAt: new Date(data.broadcastStartTime || new Date()),
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
        },
      });
    }

    // Future: live video tracking (viewers, peak concurrent, duration)
  }

  /**
   * Handle engagement updates (shares, etc.)
   */
  private async handleEngagementUpdate(_data: Record<string, any>, _entities: any): Promise<void> {
    // Future: real-time engagement tracking, analytics updates, milestone notifications
  }
}
