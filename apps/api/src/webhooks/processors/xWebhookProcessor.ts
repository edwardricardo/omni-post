/**
 * @file xWebhookProcessor.ts
 * @description X (Twitter) webhook processor with dual base64/hex HMAC verification
 *              handling tweet creation, mention, and engagement events.
 * @layer infrastructure
 */
import { createHmac } from "crypto";
import type { WebhookEventType } from "@infra/prisma";
import type { ProviderName } from "@shared/types";
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
    let eventType: WebhookEventType;
    let normalizedData: Record<string, unknown> = {};

    // Handle different X webhook event types
    if (payload.tweet_create_events) {
      eventType = "POST_PUBLISHED";
      const events = payload.tweet_create_events as Record<string, unknown>[];
      normalizedData = await this.parseTweetCreateEvent(events[0] as Record<string, unknown>);
    } else if (payload.tweet_delete_events) {
      eventType = "POST_DELETED";
      const events = payload.tweet_delete_events as Record<string, unknown>[];
      normalizedData = await this.parseTweetDeleteEvent(events[0] as Record<string, unknown>);
    } else if (payload.favorite_events) {
      eventType = "LIKE_RECEIVED";
      const events = payload.favorite_events as Record<string, unknown>[];
      normalizedData = await this.parseFavoriteEvent(events[0] as Record<string, unknown>);
    } else if (payload.retweet_events) {
      eventType = "SHARE_RECEIVED";
      const events = payload.retweet_events as Record<string, unknown>[];
      normalizedData = await this.parseRetweetEvent(events[0] as Record<string, unknown>);
    } else if (payload.reply_events) {
      eventType = "COMMENT_RECEIVED";
      const events = payload.reply_events as Record<string, unknown>[];
      normalizedData = await this.parseReplyEvent(events[0] as Record<string, unknown>);
    } else if (payload.direct_message_events) {
      eventType = "COMMENT_RECEIVED"; // Treating DMs as comments
      const events = payload.direct_message_events as Record<string, unknown>[];
      normalizedData = await this.parseDirectMessageEvent(events[0] as Record<string, unknown>);
    } else if (payload.follow_events) {
      eventType = "ACCOUNT_CONNECTED";
      const events = payload.follow_events as Record<string, unknown>[];
      normalizedData = await this.parseFollowEvent(events[0] as Record<string, unknown>);
    } else if (payload.user_event) {
      eventType = "ACCOUNT_DISCONNECTED";
      normalizedData = await this.parseUserEvent(payload.user_event as Record<string, unknown>);
    } else {
      throw AppError.badRequest(
        `Unsupported X webhook event type: ${Object.keys(payload).join(", ")}`
      );
    }

    // Find related entities based on user ID or tweet content
    const relatedEntities = await this.findRelatedEntities(payload, normalizedData);

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
  private async parseTweetCreateEvent(
    tweet: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const user = (tweet.user ?? {}) as Record<string, unknown>;
    return {
      eventType: "tweet_created",
      tweetId: tweet.id_str,
      text: tweet.text || tweet.full_text,
      userId: user.id_str,
      screenName: user.screen_name,
      createdAt: tweet.created_at,
      retweetCount: tweet.retweet_count || 0,
      favoriteCount: tweet.favorite_count || 0,
      replyToTweetId: tweet.in_reply_to_status_id_str,
      isRetweet: !!tweet.retweeted_status,
      entities: tweet.entities,
      extendedEntities: tweet.extended_entities,
      isThread: !!tweet.in_reply_to_status_id_str && tweet.in_reply_to_user_id_str === user.id_str,
    };
  }

  /**
   * Parse tweet deletion events
   */
  private async parseTweetDeleteEvent(
    deleteEvent: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const status = (deleteEvent.status ?? {}) as Record<string, unknown>;
    return {
      eventType: "tweet_deleted",
      tweetId: status.id_str,
      userId: status.user_id_str,
      deletedAt: new Date().toISOString(),
    };
  }

  /**
   * Parse favorite (like) events
   */
  private async parseFavoriteEvent(
    favorite: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const favoritedStatus = (favorite.favorited_status ?? {}) as Record<string, unknown>;
    const user = (favorite.user ?? {}) as Record<string, unknown>;
    const targetUser = (favoritedStatus.user ?? {}) as Record<string, unknown>;
    return {
      eventType: "like_received",
      tweetId: favoritedStatus.id_str,
      userId: user.id_str,
      screenName: user.screen_name,
      createdAt: favorite.created_at,
      targetTweetUserId: targetUser.id_str,
    };
  }

  /**
   * Parse retweet events
   */
  private async parseRetweetEvent(
    retweet: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const retweetedStatus = (retweet.retweeted_status ?? {}) as Record<string, unknown>;
    const user = (retweet.user ?? {}) as Record<string, unknown>;
    return {
      eventType: "retweet_received",
      retweetId: retweet.id_str,
      originalTweetId: retweetedStatus.id_str,
      userId: user.id_str,
      screenName: user.screen_name,
      createdAt: retweet.created_at,
      retweetText: retweet.text || retweet.full_text,
    };
  }

  /**
   * Parse reply events
   */
  private async parseReplyEvent(reply: Record<string, unknown>): Promise<Record<string, unknown>> {
    const user = (reply.user ?? {}) as Record<string, unknown>;
    return {
      eventType: "reply_received",
      replyId: reply.id_str,
      text: reply.text || reply.full_text,
      userId: user.id_str,
      screenName: user.screen_name,
      createdAt: reply.created_at,
      inReplyToTweetId: reply.in_reply_to_status_id_str,
      inReplyToUserId: reply.in_reply_to_user_id_str,
    };
  }

  /**
   * Parse direct message events
   */
  private async parseDirectMessageEvent(
    dm: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const messageCreate = (dm.message_create ?? {}) as Record<string, unknown>;
    const messageData = (messageCreate.message_data ?? {}) as Record<string, unknown>;
    const target = (messageCreate.target ?? {}) as Record<string, unknown>;
    return {
      eventType: "direct_message",
      messageId: dm.id,
      text: messageData.text,
      senderId: messageCreate.sender_id,
      recipientId: target.recipient_id,
      createdAt: dm.created_timestamp,
      isDirectMessage: true,
    };
  }

  /**
   * Parse follow events
   */
  private async parseFollowEvent(
    follow: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const source = (follow.source ?? {}) as Record<string, unknown>;
    const target = (follow.target ?? {}) as Record<string, unknown>;
    return {
      eventType: "follow_event",
      followerId: source.id_str,
      followedId: target.id_str,
      followerScreenName: source.screen_name,
      followedScreenName: target.screen_name,
      createdAt: follow.created_at,
      type: follow.type, // follow or unfollow
    };
  }

  /**
   * Parse user events (account changes)
   */
  private async parseUserEvent(
    userEvent: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return {
      eventType: userEvent.revoked ? "account_disconnected" : "account_updated",
      userId: userEvent.id_str,
      screenName: userEvent.screen_name,
      changes: (userEvent.revoked || userEvent.revoke || {}) as Record<string, unknown>,
    };
  }

  /**
   * Find related database entities based on X user ID or tweet content
   */
  private async findRelatedEntities(
    _payload: Record<string, unknown>,
    normalizedData: Record<string, unknown>
  ) {
    let userId: string | undefined;
    let tweetId: string | undefined;

    // Extract user ID from various event types
    if (normalizedData.userId) {
      userId = normalizedData.userId as string;
    } else if (normalizedData.targetTweetUserId) {
      userId = normalizedData.targetTweetUserId as string;
    }

    if (normalizedData.tweetId) {
      tweetId = normalizedData.tweetId as string;
    } else if (normalizedData.originalTweetId) {
      tweetId = normalizedData.originalTweetId as string;
    }

    // Find channel by X user ID via the dedicated `providerAccountId` column.
    // Both `user_id` and `id_str` from X webhooks must be persisted to that
    // column at OAuth-callback time so this lookup matches.
    if (!userId) {
      return {};
    }
    const channel = await this.prisma.channel.findFirst({
      where: {
        provider: "X",
        providerAccountId: userId as string,
        deletedAt: null,
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
      const publishLog = await this.prisma.publishLog.findFirst({
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

    const result: Record<string, unknown> = {
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
  private async handleTweetCreated(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const postId = entities.postId as string | undefined;
    const channelId = entities.channelId as string | undefined;

    if (postId && channelId) {
      // Update publish log with X tweet ID
      await this.prisma.publishLog.updateMany({
        where: {
          postId,
          channelId,
          provider: "X",
        },
        data: {
          status: "OK",
          payload: {
            tweet_id: String(data.tweetId ?? ""),
            retweet_count: Number(data.retweetCount ?? 0),
            favorite_count: Number(data.favoriteCount ?? 0),
            is_thread: Boolean(data.isThread),
            webhook_received_at: new Date().toISOString(),
          },
        },
      });

      // Update post status
      await this.prisma.post.update({
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
        externalId: Number(data.tweetId ?? 0),
        views: 0, // X doesn't provide initial view count
        likes: Number(data.favoriteCount ?? 0),
        comments: 0, // Will be updated by reply events
        shares: Number(data.retweetCount ?? 0),
      });
    }
  }

  /**
   * Handle tweet deleted event
   */
  private async handleTweetDeleted(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const entityPostId = entities.postId as string | undefined;
    const entityChannelId = entities.channelId as string | undefined;

    if (entityPostId) {
      const whereClause: Record<string, unknown> = {
        postId: entityPostId,
        provider: "X",
        payload: {
          path: ["tweet_id"],
          equals: data.tweetId as string,
        },
      };
      if (entityChannelId) {
        whereClause.channelId = entityChannelId;
      }
      // Update publish log to reflect deletion
      await this.prisma.publishLog.updateMany({
        where: whereClause,
        data: {
          status: "ERR",
          payload: {
            deleted_at: String(data.deletedAt ?? ""),
            webhook_received_at: new Date().toISOString(),
          },
        },
      });
    }
  }

  /**
   * Handle like received event
   */
  private async handleLikeReceived(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    if (entities.accountId && entities.projectId && entities.channelId) {
      await this.incrementAnalytics(entities, data.tweetId as string, "likes", 1);

      // Broadcast real-time engagement update
      const entityPostId = entities.postId as string | undefined;
      if (this.broadcaster && entityPostId) {
        await this.broadcaster.broadcastEngagementUpdate(entityPostId, "X", {}, { likes: 1 });
      }
    }
  }

  /**
   * Handle retweet received event
   */
  private async handleRetweetReceived(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    if (entities.accountId && entities.projectId && entities.channelId) {
      await this.incrementAnalytics(entities, data.originalTweetId as string, "shares", 1);

      // Broadcast real-time engagement update
      const entityPostId = entities.postId as string | undefined;
      if (this.broadcaster && entityPostId) {
        await this.broadcaster.broadcastEngagementUpdate(entityPostId, "X", {}, { shares: 1 });
      }
    }
  }

  /**
   * Handle reply received event
   */
  private async handleReplyReceived(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    if (entities.accountId && entities.projectId && entities.channelId) {
      await this.incrementAnalytics(entities, data.inReplyToTweetId as string, "comments", 1);

      // Broadcast real-time engagement update
      const entityPostId = entities.postId as string | undefined;
      if (this.broadcaster && entityPostId) {
        await this.broadcaster.broadcastEngagementUpdate(entityPostId, "X", {}, { comments: 1 });
      }
    }

    // Future: reply notifications and sentiment analysis
  }

  /**
   * Handle direct message event
   */
  private async handleDirectMessage(
    data: Record<string, unknown>,
    _entities: Record<string, unknown>
  ): Promise<void> {
    // Future: DM tracking, auto-response, and customer service integration
    webhookLogger.info({ provider: "X", dm: data }, "X direct message received");
  }

  /**
   * Handle follow event
   */
  private async handleFollowEvent(
    data: Record<string, unknown>,
    _entities: Record<string, unknown>
  ): Promise<void> {
    // Future: follower tracking and account metrics updates
    webhookLogger.info({ provider: "X", follow: data }, "X follow event");
  }

  /**
   * Update analytics with new data
   */
  private async updateAnalytics(
    entities: Record<string, unknown>,
    metrics: Record<string, number>
  ): Promise<void> {
    const entityChannelId = entities.channelId as string;
    const entityPostId = entities.postId as string | undefined;

    const whereClause: Record<string, unknown> = {
      channelId: entityChannelId,
      provider: "X",
    };
    if (entityPostId) {
      whereClause.postId = entityPostId;
    }

    const existing = await this.prisma.analytics.findFirst({ where: whereClause });

    if (existing) {
      await this.prisma.analytics.update({
        where: { id: existing.id },
        data: {
          ...metrics,
          capturedAt: new Date(),
        },
      });
    } else {
      await this.prisma.analytics.create({
        data: {
          channelId: entityChannelId,
          provider: "X",
          ...(entityPostId ? { postId: entityPostId } : {}),
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
    entities: Record<string, unknown>,
    _tweetId: string,
    metric: string,
    increment: number
  ): Promise<void> {
    const entityChannelId = entities.channelId as string;
    const entityPostId = entities.postId as string | undefined;

    const whereClause: Record<string, unknown> = {
      channelId: entityChannelId,
      provider: "X",
    };
    if (entityPostId) {
      whereClause.postId = entityPostId;
    }

    const existing = await this.prisma.analytics.findFirst({ where: whereClause });

    if (existing) {
      await this.prisma.analytics.update({
        where: { id: existing.id },
        data: {
          [metric]: { increment },
          capturedAt: new Date(),
        },
      });
    } else {
      // Create new analytics entry if it doesn't exist
      await this.prisma.analytics.create({
        data: {
          channelId: entityChannelId,
          provider: "X",
          ...(entityPostId ? { postId: entityPostId } : {}),
          [metric]: increment,
          capturedAt: new Date(),
        },
      });
    }
  }
}
