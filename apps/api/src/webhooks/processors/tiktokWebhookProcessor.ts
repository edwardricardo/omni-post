import type { WebhookEventType } from "@infra/prisma";
import type { ProviderName } from "@shared/types";
import { prisma } from "@infra/prisma";
import { webhookLogger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors/AppError.js";
import { AbstractWebhookProcessor } from "./AbstractWebhookProcessor.js";

/**
 * TikTok Webhook Processor
 * Handles webhooks from TikTok Business API
 *
 * Inherits HMAC-SHA256 signature verification from AbstractWebhookProcessor.
 *
 * TikTok webhook events include:
 * - Video published/created (video.create)
 * - Video removed/deleted (video.remove)
 * - User authorization revoked (user.authorization.revoke)
 * - Comment events (comment.create, comment.reply)
 * - Video statistics updates (views, likes, shares, comments)
 */
export class TikTokWebhookProcessor extends AbstractWebhookProcessor {
  protected override providerId: ProviderName = "TIKTOK";
  protected override signaturePrefix = "sha256=";
  protected override signatureEncoding: "hex" | "base64" = "hex";

  /**
   * Parse TikTok webhook payload and normalize data
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
    const event = payload.event as Record<string, unknown> | undefined;
    if (!event) {
      throw AppError.badRequest("Invalid TikTok webhook payload: missing event");
    }

    // Determine event type based on payload structure
    let eventType: WebhookEventType;
    let normalizedData: Record<string, unknown> = {};

    const eventTypeStr =
      (event.type as string | undefined) || (event.event_type as string | undefined);
    const eventContent = (event.content ?? {}) as Record<string, unknown>;

    switch (eventTypeStr) {
      case "video.create":
      case "video.publish":
        eventType = "POST_PUBLISHED";
        normalizedData = await this.parseVideoCreateEvent(eventContent);
        break;

      case "video.remove":
      case "video.delete":
        eventType = "POST_DELETED";
        normalizedData = await this.parseVideoRemoveEvent(eventContent);
        break;

      case "comment.create":
        eventType = "COMMENT_RECEIVED";
        normalizedData = await this.parseCommentEvent(eventContent);
        break;

      case "comment.reply":
        eventType = "COMMENT_RECEIVED";
        normalizedData = await this.parseCommentReplyEvent(eventContent);
        break;

      case "user.authorization.revoke":
        eventType = "ACCOUNT_DISCONNECTED";
        normalizedData = await this.parseAuthRevokeEvent(eventContent);
        break;

      case "video.statistics.update":
        eventType = "POST_ENGAGEMENT_UPDATE";
        normalizedData = await this.parseVideoStatsEvent(eventContent);
        break;

      default:
        eventType = "POST_UPDATED";
        normalizedData = { eventType: eventTypeStr, content: eventContent };
    }

    // Find related entities based on TikTok user ID or video ID
    const relatedEntities = await this.findRelatedEntities(eventContent, normalizedData);

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
        { provider: "TIKTOK" },
        "No related account or project found for webhook event"
      );
      return;
    }

    switch (normalizedData.eventType) {
      case "video_created":
        await this.handleVideoCreated(normalizedData, relatedEntities);
        break;

      case "video_removed":
        await this.handleVideoRemoved(normalizedData, relatedEntities);
        break;

      case "comment_received":
        await this.handleCommentReceived(normalizedData, relatedEntities);
        break;

      case "comment_reply_received":
        await this.handleCommentReplyReceived(normalizedData, relatedEntities);
        break;

      case "auth_revoked":
        await this.handleAuthRevoked(normalizedData, relatedEntities);
        break;

      case "video_statistics_update":
        await this.handleVideoStatsUpdate(normalizedData, relatedEntities);
        break;

      default:
        webhookLogger.warn(
          { provider: "TIKTOK", eventType: normalizedData.eventType },
          "Unknown TikTok event type"
        );
    }
  }

  /**
   * Parse video creation/publication events
   */
  private async parseVideoCreateEvent(
    content: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return {
      eventType: "video_created",
      videoId: content.video_id || content.id,
      userId: content.user_id || content.author_id,
      title: content.title || content.video_description,
      description: content.video_description || content.description,
      coverUrl: content.cover_image_url || content.cover_url,
      videoUrl: content.video_url || content.share_url,
      shareUrl: content.share_url,
      duration: content.duration,
      createdAt: content.create_time || content.created_at,
      publishedAt: content.publish_time || content.published_at,
      isPrivate: content.is_private || false,
    };
  }

  /**
   * Parse video removal/deletion events
   */
  private async parseVideoRemoveEvent(
    content: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return {
      eventType: "video_removed",
      videoId: content.video_id || content.id,
      userId: content.user_id || content.author_id,
      removedAt: content.remove_time || content.deleted_at || new Date().toISOString(),
      reason: content.reason || "user_deleted",
    };
  }

  /**
   * Parse comment events
   */
  private async parseCommentEvent(
    content: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return {
      eventType: "comment_received",
      commentId: content.comment_id || content.id,
      videoId: content.video_id,
      text: content.comment_text || content.text,
      userId: content.user_id || content.commenter_id,
      username: content.username || content.commenter_username,
      createdAt: content.create_time || content.created_at,
      parentId: content.parent_comment_id,
      isReply: false,
      likeCount: content.like_count || 0,
    };
  }

  /**
   * Parse comment reply events
   */
  private async parseCommentReplyEvent(
    content: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return {
      eventType: "comment_reply_received",
      commentId: content.comment_id || content.id,
      videoId: content.video_id,
      text: content.comment_text || content.text,
      userId: content.user_id || content.commenter_id,
      username: content.username || content.commenter_username,
      createdAt: content.create_time || content.created_at,
      parentId: content.parent_comment_id || content.reply_to_comment_id,
      isReply: true,
      likeCount: content.like_count || 0,
    };
  }

  /**
   * Parse authorization revocation events
   */
  private async parseAuthRevokeEvent(
    content: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return {
      eventType: "auth_revoked",
      userId: content.user_id || content.open_id,
      revokedAt: content.revoke_time || content.revoked_at || new Date().toISOString(),
      reason: content.reason || "user_revoked",
      scopes: content.scopes || [],
    };
  }

  /**
   * Parse video statistics update events
   */
  private async parseVideoStatsEvent(
    content: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return {
      eventType: "video_statistics_update",
      videoId: content.video_id || content.id,
      userId: content.user_id || content.author_id,
      views: content.view_count || content.play_count || 0,
      likes: content.like_count || 0,
      comments: content.comment_count || 0,
      shares: content.share_count || 0,
      saves: content.save_count || content.favorite_count || 0,
      completionRate: content.completion_rate || content.average_time_watched,
      capturedAt: content.captured_at || new Date().toISOString(),
    };
  }

  /**
   * Find related database entities based on TikTok user ID or video ID
   */
  private async findRelatedEntities(
    content: Record<string, unknown>,
    normalizedData: Record<string, unknown>
  ) {
    const userId = content.user_id || content.author_id || normalizedData.userId;
    const videoId = content.video_id || normalizedData.videoId;

    // Find channel by TikTok user ID
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "TIKTOK",
        // Look for TikTok user ID in credentials
        OR: [
          {
            // Prisma JSON path filter — no typed alternative available
            credentials: { path: ["user_id"], equals: userId, array_contains: null } as object,
          },
          {
            // Prisma JSON path filter — no typed alternative available
            credentials: { path: ["open_id"], equals: userId, array_contains: null } as object,
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

    // Try to find related post if we have video ID
    if (videoId) {
      const publishLog = await prisma.publishLog.findFirst({
        where: {
          channelId: channel.id,
          provider: "TIKTOK",
          // Look for TikTok video ID in payload
          payload: {
            path: ["video_id"],
            equals: videoId,
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
   * Handle video created event
   */
  private async handleVideoCreated(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const postId = entities.postId as string | undefined;
    const channelId = entities.channelId as string | undefined;

    if (postId && channelId) {
      // Update publish log with TikTok video ID
      await prisma.publishLog.updateMany({
        where: {
          postId,
          channelId,
          provider: "TIKTOK",
        },
        data: {
          status: "OK",
          payload: {
            video_id: String(data.videoId ?? ""),
            share_url: String(data.shareUrl ?? ""),
            cover_url: String(data.coverUrl ?? ""),
            duration: String(data.duration ?? ""),
            is_private: Boolean(data.isPrivate),
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
        await this.broadcaster.broadcastPostStatusChange(postId, "PUBLISHED", "TIKTOK", {
          video_id: data.videoId,
          share_url: data.shareUrl,
          cover_url: data.coverUrl,
          duration: data.duration,
        });
      }
    }

    // Store TikTok analytics if available
    if (entities.accountId && entities.projectId && channelId) {
      await prisma.analytics.create({
        data: {
          channelId,
          provider: "TIKTOK",
          ...(postId && { postId }),
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          capturedAt: new Date((data.createdAt ?? data.publishedAt) as string | number),
        },
      });
    }
  }

  /**
   * Handle video removed event
   */
  private async handleVideoRemoved(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const postId = entities.postId as string | undefined;
    const channelId = entities.channelId as string | undefined;

    if (postId && channelId) {
      // Update publish log to reflect deletion
      await prisma.publishLog.updateMany({
        where: {
          postId,
          channelId,
          provider: "TIKTOK",
          payload: {
            path: ["video_id"],
            equals: data.videoId as string,
          },
        },
        data: {
          status: "ERR",
          payload: {
            video_id: String(data.videoId ?? ""),
            removed_at: String(data.removedAt ?? ""),
            reason: String(data.reason ?? ""),
            webhook_received_at: new Date().toISOString(),
          },
        },
      });

      // Update post status
      await prisma.post.update({
        where: { id: postId },
        data: { status: "FAILED" },
      });

      // Broadcast real-time post status update
      if (this.broadcaster) {
        await this.broadcaster.broadcastPostStatusChange(postId, "FAILED", "TIKTOK", {
          video_id: data.videoId,
          removed_at: data.removedAt,
          reason: data.reason,
        });
      }
    }
  }

  /**
   * Handle comment received event
   */
  private async handleCommentReceived(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    // Create/update analytics entry for comment engagement
    if (entities.accountId && entities.projectId && entities.channelId && data.videoId) {
      const entityChannelId = entities.channelId as string;
      const entityPostId = entities.postId as string | undefined;
      // Find existing analytics record and increment comments
      const existing = await prisma.analytics.findFirst({
        where: {
          channelId: entityChannelId,
          provider: "TIKTOK",
          ...(entityPostId && { postId: entityPostId }),
        },
      });

      if (existing) {
        const currentComments = existing.comments || 0;
        await prisma.analytics.update({
          where: { id: existing.id },
          data: {
            comments: { increment: 1 },
            capturedAt: new Date(),
          },
        });

        // Broadcast real-time engagement update
        if (this.broadcaster && entityPostId) {
          await this.broadcaster.broadcastEngagementUpdate(
            entityPostId,
            "TIKTOK",
            { comments: currentComments + 1 },
            { comments: 1 }
          );
        }
      }
    }

    // Future: comment notifications, automated moderation, analytics storage
  }

  /**
   * Handle comment reply received event
   */
  private async handleCommentReplyReceived(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    // Similar to regular comment handling
    await this.handleCommentReceived(data, entities);

    // Future: threaded comment tracking and reply notifications
  }

  /**
   * Handle authorization revoked event
   */
  private async handleAuthRevoked(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const channelId = entities.channelId as string | undefined;

    if (channelId) {
      // Update channel credentials to mark as revoked
      const channel = await prisma.channel.findUnique({ where: { id: channelId } });
      if (channel) {
        const existingCreds = (channel.credentials ?? {}) as Record<string, unknown>;
        await prisma.channel.update({
          where: { id: channelId },
          data: {
            credentials: {
              ...existingCreds,
              revoked_at: String(data.revokedAt ?? ""),
              revoke_reason: String(data.reason ?? ""),
            },
          },
        });
      }

      // Future: notify owner, fail scheduled posts, and deactivate channel
    }
  }

  /**
   * Handle video statistics update event
   */
  private async handleVideoStatsUpdate(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const entityChannelId = entities.channelId as string | undefined;
    const entityPostId = entities.postId as string | undefined;
    const views = Number(data.views ?? 0);
    const likes = Number(data.likes ?? 0);
    const comments = Number(data.comments ?? 0);
    const shares = Number(data.shares ?? 0);

    if (entities.accountId && entities.projectId && entityChannelId && data.videoId) {
      // Update analytics with latest statistics
      const existing = await prisma.analytics.findFirst({
        where: {
          channelId: entityChannelId,
          provider: "TIKTOK",
          ...(entityPostId && { postId: entityPostId }),
        },
      });

      if (existing) {
        const oldMetrics = {
          views: existing.views || 0,
          likes: existing.likes || 0,
          comments: existing.comments || 0,
          shares: existing.shares || 0,
        };

        await prisma.analytics.update({
          where: { id: existing.id },
          data: {
            views,
            likes,
            comments,
            shares,
            capturedAt: new Date(data.capturedAt as string | number),
          },
        });

        // Broadcast real-time engagement update
        if (this.broadcaster && entityPostId) {
          await this.broadcaster.broadcastEngagementUpdate(
            entityPostId,
            "TIKTOK",
            { views, likes, comments, shares },
            {
              views: views - oldMetrics.views,
              likes: likes - oldMetrics.likes,
              comments: comments - oldMetrics.comments,
              shares: shares - oldMetrics.shares,
            }
          );
        }
      } else {
        // Create new analytics record if it doesn't exist
        await prisma.analytics.create({
          data: {
            channelId: entityChannelId,
            provider: "TIKTOK",
            ...(entityPostId && { postId: entityPostId }),
            views,
            likes,
            comments,
            shares,
            capturedAt: new Date(data.capturedAt as string | number),
          },
        });
      }
    }
  }
}
