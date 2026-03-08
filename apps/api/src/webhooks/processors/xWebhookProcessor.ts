import { createHmac } from "crypto";
import type { WebhookEventType } from "@infra/prisma";
import type { ProviderName } from "@shared/types";
import { prisma } from "@infra/prisma";
import { webhookLogger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors/AppError.js";
import { AbstractWebhookProcessor } from "./AbstractWebhookProcessor.js";

/**
 * X (Twitter) Webhook Processor
 * Handles webhooks from X Platform API (formerly Twitter API)
 *
 * Extends AbstractWebhookProcessor but overrides `verify()` because X uses
 * a dual base64/hex comparison strategy that differs from the standard flow.
 *
 * X webhook events include:
 * - Tweet create/delete events
 * - Engagement events (likes, retweets, replies)
 * - Direct message events
 * - Follow/unfollow events
 * - Account updates
 */
export class XWebhookProcessor extends AbstractWebhookProcessor {
  protected override providerId: ProviderName = "X";
  protected override signaturePrefix = "sha256=";
  protected override signatureEncoding: "hex" | "base64" = "base64";

  /**
   * Verify X (Twitter) webhook signature
   * Uses HMAC-SHA256 with consumer secret.
   *
   * X requires a dual comparison strategy: the signature may arrive as
   * base64 or hex, so both encodings are tried for compatibility.
   */
  override verify(
    payload: string,
    signature: string,
    secret: string,
    _headers?: Record<string, string>
  ): boolean {
    try {
      // X uses 'sha256=' prefix in signature
      const cleanSignature = signature.replace("sha256=", "");

      // Calculate expected signature using X's method
      const expectedSignature = createHmac("sha256", secret)
        .update(payload, "utf8")
        .digest("base64");

      // Convert to hex for comparison if needed
      const expectedHex = Buffer.from(expectedSignature, "base64").toString("hex");

      // Try both base64 and hex comparisons
      return (
        this.constantTimeCompare(cleanSignature, expectedSignature) ||
        this.constantTimeCompare(cleanSignature, expectedHex)
      );
    } catch (error) {
      webhookLogger.error({ err: error, provider: "X" }, "Webhook signature verification failed");
      return false;
    }
  }

  /**
   * Parse X webhook payload and normalize data
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
    let eventType: WebhookEventType;
    let normalizedData: Record<string, any> = {};
    let relatedEntities: any = {};

    // Handle different X webhook event types
    if (payload.tweet_create_events) {
      eventType = "POST_PUBLISHED";
      normalizedData = await this.parseTweetCreateEvent(payload.tweet_create_events[0]);
    } else if (payload.tweet_delete_events) {
      eventType = "POST_DELETED";
      normalizedData = await this.parseTweetDeleteEvent(payload.tweet_delete_events[0]);
    } else if (payload.favorite_events) {
      eventType = "LIKE_RECEIVED";
      normalizedData = await this.parseFavoriteEvent(payload.favorite_events[0]);
    } else if (payload.retweet_events) {
      eventType = "SHARE_RECEIVED";
      normalizedData = await this.parseRetweetEvent(payload.retweet_events[0]);
    } else if (payload.reply_events) {
      eventType = "COMMENT_RECEIVED";
      normalizedData = await this.parseReplyEvent(payload.reply_events[0]);
    } else if (payload.direct_message_events) {
      eventType = "COMMENT_RECEIVED"; // Treating DMs as comments
      normalizedData = await this.parseDirectMessageEvent(payload.direct_message_events[0]);
    } else if (payload.follow_events) {
      eventType = "ACCOUNT_CONNECTED";
      normalizedData = await this.parseFollowEvent(payload.follow_events[0]);
    } else if (payload.user_event) {
      eventType = "ACCOUNT_DISCONNECTED";
      normalizedData = await this.parseUserEvent(payload.user_event);
    } else {
      throw AppError.badRequest(
        `Unsupported X webhook event type: ${Object.keys(payload).join(", ")}`
      );
    }

    // Find related entities based on user ID or tweet content
    relatedEntities = await this.findRelatedEntities(payload, normalizedData);

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
        { provider: "X" },
        "No related account or project found for webhook event"
      );
      return;
    }

    switch (normalizedData.eventType) {
      case "tweet_created":
        await this.handleTweetCreated(normalizedData, relatedEntities);
        break;

      case "tweet_deleted":
        await this.handleTweetDeleted(normalizedData, relatedEntities);
        break;

      case "like_received":
        await this.handleLikeReceived(normalizedData, relatedEntities);
        break;

      case "retweet_received":
        await this.handleRetweetReceived(normalizedData, relatedEntities);
        break;

      case "reply_received":
        await this.handleReplyReceived(normalizedData, relatedEntities);
        break;

      case "direct_message":
        await this.handleDirectMessage(normalizedData, relatedEntities);
        break;

      case "follow_event":
        await this.handleFollowEvent(normalizedData, relatedEntities);
        break;

      default:
        webhookLogger.warn(
          { provider: "X", eventType: normalizedData.eventType },
          "Unknown X event type"
        );
    }
  }

  /**
   * Parse tweet creation events
   */
  private async parseTweetCreateEvent(tweet: any): Promise<Record<string, any>> {
    return {
      eventType: "tweet_created",
      tweetId: tweet.id_str,
      text: tweet.text || tweet.full_text,
      userId: tweet.user.id_str,
      screenName: tweet.user.screen_name,
      createdAt: tweet.created_at,
      retweetCount: tweet.retweet_count || 0,
      favoriteCount: tweet.favorite_count || 0,
      replyToTweetId: tweet.in_reply_to_status_id_str,
      isRetweet: !!tweet.retweeted_status,
      entities: tweet.entities,
      extendedEntities: tweet.extended_entities,
      isThread:
        !!tweet.in_reply_to_status_id_str && tweet.in_reply_to_user_id_str === tweet.user.id_str,
    };
  }

  /**
   * Parse tweet deletion events
   */
  private async parseTweetDeleteEvent(deleteEvent: any): Promise<Record<string, any>> {
    return {
      eventType: "tweet_deleted",
      tweetId: deleteEvent.status?.id_str,
      userId: deleteEvent.status?.user_id_str,
      deletedAt: new Date().toISOString(),
    };
  }

  /**
   * Parse favorite (like) events
   */
  private async parseFavoriteEvent(favorite: any): Promise<Record<string, any>> {
    return {
      eventType: "like_received",
      tweetId: favorite.favorited_status?.id_str,
      userId: favorite.user?.id_str,
      screenName: favorite.user?.screen_name,
      createdAt: favorite.created_at,
      targetTweetUserId: favorite.favorited_status?.user?.id_str,
    };
  }

  /**
   * Parse retweet events
   */
  private async parseRetweetEvent(retweet: any): Promise<Record<string, any>> {
    return {
      eventType: "retweet_received",
      retweetId: retweet.id_str,
      originalTweetId: retweet.retweeted_status?.id_str,
      userId: retweet.user?.id_str,
      screenName: retweet.user?.screen_name,
      createdAt: retweet.created_at,
      retweetText: retweet.text || retweet.full_text,
    };
  }

  /**
   * Parse reply events
   */
  private async parseReplyEvent(reply: any): Promise<Record<string, any>> {
    return {
      eventType: "reply_received",
      replyId: reply.id_str,
      text: reply.text || reply.full_text,
      userId: reply.user?.id_str,
      screenName: reply.user?.screen_name,
      createdAt: reply.created_at,
      inReplyToTweetId: reply.in_reply_to_status_id_str,
      inReplyToUserId: reply.in_reply_to_user_id_str,
    };
  }

  /**
   * Parse direct message events
   */
  private async parseDirectMessageEvent(dm: any): Promise<Record<string, any>> {
    return {
      eventType: "direct_message",
      messageId: dm.id,
      text: dm.message_create?.message_data?.text,
      senderId: dm.message_create?.sender_id,
      recipientId: dm.message_create?.target?.recipient_id,
      createdAt: dm.created_timestamp,
      isDirectMessage: true,
    };
  }

  /**
   * Parse follow events
   */
  private async parseFollowEvent(follow: any): Promise<Record<string, any>> {
    return {
      eventType: "follow_event",
      followerId: follow.source?.id_str,
      followedId: follow.target?.id_str,
      followerScreenName: follow.source?.screen_name,
      followedScreenName: follow.target?.screen_name,
      createdAt: follow.created_at,
      type: follow.type, // follow or unfollow
    };
  }

  /**
   * Parse user events (account changes)
   */
  private async parseUserEvent(userEvent: any): Promise<Record<string, any>> {
    return {
      eventType: userEvent.revoked ? "account_disconnected" : "account_updated",
      userId: userEvent.id_str,
      screenName: userEvent.screen_name,
      changes: userEvent.revoked || userEvent.revoke || {},
    };
  }

  /**
   * Find related database entities based on X user ID or tweet content
   */
  private async findRelatedEntities(payload: any, normalizedData: Record<string, any>) {
    let userId: string | undefined;
    let tweetId: string | undefined;

    // Extract user ID from various event types
    if (normalizedData.userId) {
      userId = normalizedData.userId;
    } else if (normalizedData.targetTweetUserId) {
      userId = normalizedData.targetTweetUserId;
    }

    if (normalizedData.tweetId) {
      tweetId = normalizedData.tweetId;
    } else if (normalizedData.originalTweetId) {
      tweetId = normalizedData.originalTweetId;
    }

    // Find channel by X user ID
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "X",
        // Look for X user ID in credentials
        OR: [
          {
            // Prisma JSON path filter — no typed alternative available
            credentials: { path: ["user_id"], equals: userId, array_contains: null } as object,
          },
          {
            // Prisma JSON path filter — no typed alternative available
            credentials: { path: ["id_str"], equals: userId, array_contains: null } as object,
          },
        ],
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

    // Try to find related post if we have tweet ID
    if (tweetId) {
      const publishLog = await prisma.publishLog.findFirst({
        where: {
          channelId: channel.id,
          provider: "X",
          payload: {
            path: ["tweet_id"],
            equals: tweetId,
          },
        },
      });

      postId = publishLog?.postId || undefined;
    }

    const result: any = {
      accountId: channel.project.accountId,
      projectId: channel.projectId,
      channelId: channel.id,
    };
    if (postId) {
      result.postId = postId;
    }
    return result;
  }

  /**
   * Handle tweet created event
   */
  private async handleTweetCreated(data: Record<string, any>, entities: any): Promise<void> {
    const { postId, channelId } = entities;

    if (postId && channelId) {
      // Update publish log with X tweet ID
      await prisma.publishLog.updateMany({
        where: {
          postId,
          channelId,
          provider: "X",
        },
        data: {
          status: "OK",
          payload: {
            tweet_id: data.tweetId,
            retweet_count: data.retweetCount,
            favorite_count: data.favoriteCount,
            is_thread: data.isThread,
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
        await this.broadcaster.broadcastPostStatusChange(postId, "PUBLISHED", "X", {
          tweet_id: data.tweetId,
          retweet_count: data.retweetCount,
          favorite_count: data.favoriteCount,
          is_thread: data.isThread,
        });
      }
    }

    // Create/update analytics entry
    if (entities.accountId && entities.projectId && channelId) {
      await this.updateAnalytics(entities, {
        externalId: data.tweetId,
        views: 0, // X doesn't provide initial view count
        likes: data.favoriteCount,
        comments: 0, // Will be updated by reply events
        shares: data.retweetCount,
      });
    }
  }

  /**
   * Handle tweet deleted event
   */
  private async handleTweetDeleted(data: Record<string, any>, entities: any): Promise<void> {
    if (entities.postId) {
      // Update publish log to reflect deletion
      await prisma.publishLog.updateMany({
        where: {
          postId: entities.postId,
          channelId: entities.channelId,
          provider: "X",
          payload: {
            path: ["tweet_id"],
            equals: data.tweetId,
          },
        },
        data: {
          status: "ERR",
          payload: {
            deleted_at: data.deletedAt,
            webhook_received_at: new Date().toISOString(),
          },
        },
      });
    }
  }

  /**
   * Handle like received event
   */
  private async handleLikeReceived(data: Record<string, any>, entities: any): Promise<void> {
    if (entities.accountId && entities.projectId && entities.channelId) {
      await this.incrementAnalytics(entities, data.tweetId, "likes", 1);

      // Broadcast real-time engagement update
      if (this.broadcaster && entities.postId) {
        await this.broadcaster.broadcastEngagementUpdate(entities.postId, "X", {}, { likes: 1 });
      }
    }
  }

  /**
   * Handle retweet received event
   */
  private async handleRetweetReceived(data: Record<string, any>, entities: any): Promise<void> {
    if (entities.accountId && entities.projectId && entities.channelId) {
      await this.incrementAnalytics(entities, data.originalTweetId, "shares", 1);

      // Broadcast real-time engagement update
      if (this.broadcaster && entities.postId) {
        await this.broadcaster.broadcastEngagementUpdate(entities.postId, "X", {}, { shares: 1 });
      }
    }
  }

  /**
   * Handle reply received event
   */
  private async handleReplyReceived(data: Record<string, any>, entities: any): Promise<void> {
    if (entities.accountId && entities.projectId && entities.channelId) {
      await this.incrementAnalytics(entities, data.inReplyToTweetId, "comments", 1);

      // Broadcast real-time engagement update
      if (this.broadcaster && entities.postId) {
        await this.broadcaster.broadcastEngagementUpdate(entities.postId, "X", {}, { comments: 1 });
      }
    }

    // Future: reply notifications and sentiment analysis
  }

  /**
   * Handle direct message event
   */
  private async handleDirectMessage(data: Record<string, any>, _entities: any): Promise<void> {
    // Future: DM tracking, auto-response, and customer service integration
    webhookLogger.info({ provider: "X", dm: data }, "X direct message received");
  }

  /**
   * Handle follow event
   */
  private async handleFollowEvent(data: Record<string, any>, _entities: any): Promise<void> {
    // Future: follower tracking and account metrics updates
    webhookLogger.info({ provider: "X", follow: data }, "X follow event");
  }

  /**
   * Update analytics with new data
   */
  private async updateAnalytics(entities: any, metrics: Record<string, number>): Promise<void> {
    const existing = await prisma.analytics.findFirst({
      where: {
        channelId: entities.channelId,
        provider: "X",
        postId: entities.postId,
      },
    });

    if (existing) {
      await prisma.analytics.update({
        where: { id: existing.id },
        data: {
          ...metrics,
          capturedAt: new Date(),
        },
      });
    } else {
      await prisma.analytics.create({
        data: {
          channelId: entities.channelId,
          provider: "X",
          postId: entities.postId,
          ...metrics,
          capturedAt: new Date(),
        },
      });
    }
  }

  /**
   * Increment specific analytics metric
   */
  private async incrementAnalytics(
    entities: any,
    tweetId: string,
    metric: string,
    increment: number
  ): Promise<void> {
    const existing = await prisma.analytics.findFirst({
      where: {
        channelId: entities.channelId,
        provider: "X",
        postId: entities.postId,
      },
    });

    if (existing) {
      await prisma.analytics.update({
        where: { id: existing.id },
        data: {
          [metric]: { increment },
          capturedAt: new Date(),
        },
      });
    } else {
      // Create new analytics entry if it doesn't exist
      await prisma.analytics.create({
        data: {
          channelId: entities.channelId,
          provider: "X",
          postId: entities.postId,
          [metric]: increment,
          capturedAt: new Date(),
        },
      });
    }
  }
}
