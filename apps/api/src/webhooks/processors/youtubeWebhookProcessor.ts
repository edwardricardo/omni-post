import type { WebhookEventType } from "@infra/prisma";
import type { ProviderName } from "@shared/types";
import { prisma } from "@infra/prisma";
import { parseStringPromise } from "xml2js";
import { webhookLogger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors/AppError.js";
import { AbstractWebhookProcessor } from "./AbstractWebhookProcessor.js";

/**
 * YouTube Webhook Processor
 * Handles webhooks from YouTube Data API v3 using PubSubHubbub protocol
 *
 * Inherits HMAC signature verification from AbstractWebhookProcessor,
 * overriding `getHmacAlgorithm()` to use SHA1 (PubSubHubbub protocol).
 *
 * YouTube webhook events include:
 * - Video published/updated (feed entries)
 * - Comment notifications
 * - Channel updates
 * - Analytics updates
 */
export class YouTubeWebhookProcessor extends AbstractWebhookProcessor {
  protected override providerId: ProviderName = "YOUTUBE";
  protected override signaturePrefix = "sha1=";
  protected override signatureEncoding: "hex" | "base64" = "hex";

  /**
   * YouTube PubSubHubbub uses HMAC-SHA1 instead of the default SHA256
   */
  protected override getHmacAlgorithm(): string {
    return "sha1";
  }

  /**
   * Parse YouTube webhook payload and normalize data
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

    // YouTube webhooks come as Atom/XML format for video events, or JSON for other events
    let parsedPayload: any;

    // If payload is already parsed JSON (from XML to JSON), or is a JSON event type, use it directly
    if (
      payload.feed ||
      payload.entry ||
      payload.comment ||
      payload.channelUpdate ||
      payload.analytics
    ) {
      parsedPayload = payload;
    } else if (typeof payload === "string") {
      // Parse XML if we received raw XML string (for video feed notifications)
      try {
        parsedPayload = await parseStringPromise(payload);
      } catch (error) {
        throw AppError.badRequest(
          `Failed to parse YouTube webhook XML: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else {
      // Unknown payload format
      parsedPayload = payload;
    }

    // Handle different YouTube webhook event types
    if (parsedPayload.feed?.entry) {
      // Video published/updated notification
      const entry = Array.isArray(parsedPayload.feed.entry)
        ? parsedPayload.feed.entry[0]
        : parsedPayload.feed.entry;

      const isNew = entry["yt:videoId"] && !entry.updated;
      eventType = isNew ? "POST_PUBLISHED" : "POST_UPDATED";
      normalizedData = await this.parseVideoFeedEntry(entry);
    } else if (parsedPayload.entry) {
      // Single entry notification
      const isNew = parsedPayload.entry["yt:videoId"] && !parsedPayload.entry.updated;
      eventType = isNew ? "POST_PUBLISHED" : "POST_UPDATED";
      normalizedData = await this.parseVideoFeedEntry(parsedPayload.entry);
    } else if (parsedPayload.comment) {
      // Comment notification (if enabled via YouTube API)
      eventType = "COMMENT_RECEIVED";
      normalizedData = await this.parseCommentEvent(parsedPayload.comment);
    } else if (parsedPayload.channelUpdate) {
      // Channel update notification
      eventType = "ACCOUNT_CONNECTED";
      normalizedData = await this.parseChannelUpdateEvent(parsedPayload.channelUpdate);
    } else if (parsedPayload.analytics) {
      // Analytics update (custom implementation)
      eventType = "POST_ENGAGEMENT_UPDATE";
      normalizedData = await this.parseAnalyticsEvent(parsedPayload.analytics);
    } else {
      throw AppError.badRequest(
        `Unsupported YouTube webhook event type: ${JSON.stringify(Object.keys(parsedPayload))}`
      );
    }

    // Find related entities based on YouTube channel ID or video ID
    relatedEntities = await this.findRelatedEntities(parsedPayload, normalizedData);

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
        { provider: "YOUTUBE" },
        "No related account or project found for webhook event"
      );
      return;
    }

    switch (normalizedData.eventType) {
      case "video_published":
        await this.handleVideoPublished(normalizedData, relatedEntities);
        break;

      case "video_updated":
        await this.handleVideoUpdated(normalizedData, relatedEntities);
        break;

      case "comment_received":
        await this.handleCommentReceived(normalizedData, relatedEntities);
        break;

      case "channel_updated":
        await this.handleChannelUpdated(normalizedData, relatedEntities);
        break;

      case "analytics_update":
        await this.handleAnalyticsUpdate(normalizedData, relatedEntities);
        break;

      default:
        webhookLogger.warn(
          { provider: "YOUTUBE", eventType: normalizedData.eventType },
          "Unknown YouTube event type"
        );
    }
  }

  /**
   * Parse video feed entry from PubSubHubbub notification
   */
  private async parseVideoFeedEntry(entry: any): Promise<Record<string, any>> {
    // Extract video ID from yt:videoId tag
    const videoId = entry["yt:videoId"]?.[0] || entry["yt:videoId"];
    const channelId = entry["yt:channelId"]?.[0] || entry["yt:channelId"];

    // Extract other metadata
    const title = entry.title?.[0] || entry.title;
    const link = entry.link?.[0]?.$?.href || entry.link?.$.href;
    const author = entry.author?.[0]?.name?.[0] || entry.author?.name;
    const published = entry.published?.[0] || entry.published;
    const updated = entry.updated?.[0] || entry.updated;

    return {
      eventType: updated ? "video_updated" : "video_published",
      videoId,
      channelId,
      title,
      link: link || `https://www.youtube.com/watch?v=${videoId}`,
      author,
      publishedAt: published,
      updatedAt: updated,
    };
  }

  /**
   * Parse comment events
   */
  private async parseCommentEvent(comment: any): Promise<Record<string, any>> {
    return {
      eventType: "comment_received",
      commentId: comment.id || comment.commentId,
      videoId: comment.videoId,
      channelId: comment.channelId,
      text: comment.text || comment.textDisplay,
      authorDisplayName: comment.authorDisplayName,
      authorChannelId: comment.authorChannelId,
      likeCount: comment.likeCount || 0,
      publishedAt: comment.publishedAt,
      updatedAt: comment.updatedAt,
      parentId: comment.parentId,
      isReply: !!comment.parentId,
    };
  }

  /**
   * Parse channel update events
   */
  private async parseChannelUpdateEvent(channelUpdate: any): Promise<Record<string, any>> {
    return {
      eventType: "channel_updated",
      channelId: channelUpdate.channelId,
      title: channelUpdate.title,
      description: channelUpdate.description,
      subscriberCount: channelUpdate.subscriberCount,
      videoCount: channelUpdate.videoCount,
      viewCount: channelUpdate.viewCount,
      updatedAt: channelUpdate.updatedAt || new Date().toISOString(),
    };
  }

  /**
   * Parse analytics update events
   */
  private async parseAnalyticsEvent(analytics: any): Promise<Record<string, any>> {
    return {
      eventType: "analytics_update",
      videoId: analytics.videoId,
      channelId: analytics.channelId,
      views: analytics.views || 0,
      likes: analytics.likes || 0,
      dislikes: analytics.dislikes || 0,
      comments: analytics.comments || 0,
      shares: analytics.shares || 0,
      watchTimeMinutes: analytics.watchTimeMinutes || 0,
      averageViewDuration: analytics.averageViewDuration || 0,
      estimatedRevenue: analytics.estimatedRevenue || 0,
      timestamp: analytics.timestamp || new Date().toISOString(),
    };
  }

  /**
   * Find related database entities based on YouTube channel ID or video ID
   */
  private async findRelatedEntities(payload: any, normalizedData: Record<string, any>) {
    // Extract channel ID from various sources
    let youtubeChannelId: string | undefined;
    let videoId: string | undefined;

    if (normalizedData.channelId) {
      youtubeChannelId = normalizedData.channelId;
    } else if (payload.feed?.["yt:channelId"]) {
      youtubeChannelId = payload.feed["yt:channelId"][0] || payload.feed["yt:channelId"];
    }

    if (normalizedData.videoId) {
      videoId = normalizedData.videoId;
    }

    // Find channel by YouTube channel ID
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "YOUTUBE",
        // Look for YouTube channel ID in credentials
        OR: [
          {
            // Prisma JSON path filter — no typed alternative available
            credentials: {
              path: ["channel_id"],
              equals: youtubeChannelId,
              array_contains: null,
            } as object,
          },
          {
            // Prisma JSON path filter — no typed alternative available
            credentials: {
              path: ["channelId"],
              equals: youtubeChannelId,
              array_contains: null,
            } as object,
          },
        ],
      },
      include: {
        project: true,
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
          provider: "YOUTUBE",
          OR: [
            {
              payload: {
                path: ["video_id"],
                equals: videoId,
              },
            },
            {
              payload: {
                path: ["youtube_video_id"],
                equals: videoId,
              },
            },
          ],
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
   * Handle video published event
   */
  private async handleVideoPublished(data: Record<string, any>, entities: any): Promise<void> {
    const { postId, channelId } = entities;

    if (postId && channelId) {
      // Update publish log with YouTube video ID
      await prisma.publishLog.updateMany({
        where: {
          postId,
          channelId,
          provider: "YOUTUBE",
        },
        data: {
          status: "OK",
          payload: {
            video_id: data.videoId,
            title: data.title,
            link: data.link,
            published_at: data.publishedAt,
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
        await this.broadcaster.broadcastPostStatusChange(postId, "PUBLISHED", "YOUTUBE", {
          video_id: data.videoId,
          title: data.title,
          link: data.link,
        });
      }
    }

    // Store YouTube analytics if available
    if (entities.accountId && entities.projectId && channelId) {
      await prisma.analytics.create({
        data: {
          channelId,
          provider: "YOUTUBE",
          postId: postId || null,
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          capturedAt: new Date(data.publishedAt || Date.now()),
        },
      });
    }
  }

  /**
   * Handle video updated event
   */
  private async handleVideoUpdated(data: Record<string, any>, entities: any): Promise<void> {
    const { postId, channelId } = entities;

    if (postId && channelId) {
      // Update publish log with latest video metadata
      await prisma.publishLog.updateMany({
        where: {
          postId,
          channelId,
          provider: "YOUTUBE",
          payload: {
            path: ["video_id"],
            equals: data.videoId,
          },
        },
        data: {
          payload: {
            video_id: data.videoId,
            title: data.title,
            link: data.link,
            updated_at: data.updatedAt,
            webhook_received_at: new Date().toISOString(),
          },
        },
      });

      // Broadcast real-time post update
      if (this.broadcaster) {
        await this.broadcaster.broadcastPostStatusChange(postId, "PUBLISHED", "YOUTUBE", {
          video_id: data.videoId,
          title: data.title,
          updated_at: data.updatedAt,
        });
      }
    }
  }

  /**
   * Handle comment received event
   */
  private async handleCommentReceived(data: Record<string, any>, entities: any): Promise<void> {
    // Create analytics entry for comment engagement
    if (entities.accountId && entities.projectId && data.videoId && entities.channelId) {
      // Find existing analytics record and increment comments
      const existing = await prisma.analytics.findFirst({
        where: {
          channelId: entities.channelId,
          provider: "YOUTUBE",
          postId: entities.postId || null,
        },
      });

      if (existing) {
        await prisma.analytics.update({
          where: { id: existing.id },
          data: {
            comments: { increment: 1 },
            capturedAt: new Date(),
          },
        });

        // Broadcast real-time engagement update
        if (this.broadcaster && entities.postId) {
          await this.broadcaster.broadcastEngagementUpdate(
            entities.postId,
            "YOUTUBE",
            { comments: (existing.comments || 0) + 1 },
            { comments: 1 }
          );
        }
      }
    }

    // Future: comment notifications, automated moderation, sentiment analysis
  }

  /**
   * Handle channel updated event
   */
  private async handleChannelUpdated(data: Record<string, any>, entities: any): Promise<void> {
    if (entities.channelId) {
      // Update channel metadata in database
      await prisma.channel.update({
        where: { id: entities.channelId },
        data: {
          credentials: {
            ...((await prisma.channel.findUnique({ where: { id: entities.channelId } }))
              ?.credentials as Record<string, unknown>),
            title: data.title,
            description: data.description,
            subscriber_count: data.subscriberCount,
            video_count: data.videoCount,
            view_count: data.viewCount,
            updated_at: data.updatedAt,
          },
        },
      });
    }

    // Future: channel analytics tracking and account-level metrics aggregation
  }

  /**
   * Handle analytics update event
   */
  private async handleAnalyticsUpdate(data: Record<string, any>, entities: any): Promise<void> {
    if (entities.accountId && entities.projectId && data.videoId && entities.channelId) {
      // Update or create analytics record
      const existing = await prisma.analytics.findFirst({
        where: {
          channelId: entities.channelId,
          provider: "YOUTUBE",
          postId: entities.postId || null,
        },
      });

      if (existing) {
        await prisma.analytics.update({
          where: { id: existing.id },
          data: {
            views: data.views,
            likes: data.likes,
            comments: data.comments,
            shares: data.shares,
            capturedAt: new Date(data.timestamp),
          },
        });

        // Broadcast real-time analytics update
        if (this.broadcaster && entities.postId) {
          await this.broadcaster.broadcastEngagementUpdate(
            entities.postId,
            "YOUTUBE",
            {
              views: data.views,
              likes: data.likes,
              comments: data.comments,
              shares: data.shares,
            },
            {} // No incremental changes, just totals
          );
        }
      } else {
        await prisma.analytics.create({
          data: {
            channelId: entities.channelId,
            provider: "YOUTUBE",
            postId: entities.postId || null,
            views: data.views,
            likes: data.likes,
            comments: data.comments,
            shares: data.shares,
            capturedAt: new Date(data.timestamp),
          },
        });
      }
    }

    // Future: revenue tracking and engagement prediction updates
  }
}
