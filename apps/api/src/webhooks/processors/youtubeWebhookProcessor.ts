/**
 * @file youtubeWebhookProcessor.ts
 * @description YouTube webhook processor using PubSubHubbub protocol with SHA1 HMAC
 *              verification for video published/updated and channel subscription events.
 * @layer infrastructure
 */
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

    // YouTube webhooks come as Atom/XML format for video events, or JSON for other events
    let parsedPayload: Record<string, unknown>;

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
        parsedPayload = (await parseStringPromise(payload)) as Record<string, unknown>;
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
    const feed = parsedPayload.feed as Record<string, unknown> | undefined;
    const entry = parsedPayload.entry as Record<string, unknown> | undefined;

    if (feed?.entry) {
      // Video published/updated notification
      const feedEntry = Array.isArray(feed.entry)
        ? ((feed.entry as Record<string, unknown>[])[0] ?? {})
        : (feed.entry as Record<string, unknown>);
      const feedEntryObj = feedEntry as Record<string, unknown>;

      const isNew = feedEntryObj["yt:videoId"] && !feedEntryObj.updated;
      eventType = isNew ? "POST_PUBLISHED" : "POST_UPDATED";
      normalizedData = await this.parseVideoFeedEntry(feedEntryObj);
    } else if (entry) {
      // Single entry notification
      const isNew = entry["yt:videoId"] && !entry.updated;
      eventType = isNew ? "POST_PUBLISHED" : "POST_UPDATED";
      normalizedData = await this.parseVideoFeedEntry(entry);
    } else if (parsedPayload.comment) {
      // Comment notification (if enabled via YouTube API)
      eventType = "COMMENT_RECEIVED";
      normalizedData = await this.parseCommentEvent(
        parsedPayload.comment as Record<string, unknown>
      );
    } else if (parsedPayload.channelUpdate) {
      // Channel update notification
      eventType = "ACCOUNT_CONNECTED";
      normalizedData = await this.parseChannelUpdateEvent(
        parsedPayload.channelUpdate as Record<string, unknown>
      );
    } else if (parsedPayload.analytics) {
      // Analytics update (custom implementation)
      eventType = "POST_ENGAGEMENT_UPDATE";
      normalizedData = await this.parseAnalyticsEvent(
        parsedPayload.analytics as Record<string, unknown>
      );
    } else {
      throw AppError.badRequest(
        `Unsupported YouTube webhook event type: ${JSON.stringify(Object.keys(parsedPayload))}`
      );
    }

    // Find related entities based on YouTube channel ID or video ID
    const relatedEntities = await this.findRelatedEntities(parsedPayload, normalizedData);

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
  private async parseVideoFeedEntry(
    entry: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Extract video ID from yt:videoId tag
    const ytVideoIdRaw = entry["yt:videoId"];
    const videoId = Array.isArray(ytVideoIdRaw) ? ytVideoIdRaw[0] : ytVideoIdRaw;
    const ytChannelIdRaw = entry["yt:channelId"];
    const channelId = Array.isArray(ytChannelIdRaw) ? ytChannelIdRaw[0] : ytChannelIdRaw;

    // Extract other metadata
    const titleRaw = entry.title;
    const title = Array.isArray(titleRaw) ? titleRaw[0] : titleRaw;
    const linkRaw = entry.link as Record<string, unknown> | Record<string, unknown>[] | undefined;
    const linkEntry = Array.isArray(linkRaw) ? (linkRaw[0] as Record<string, unknown>) : linkRaw;
    const linkAttrs = linkEntry?.$ as Record<string, unknown> | undefined;
    const link = linkAttrs?.href;
    const authorRaw = entry.author as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined;
    const authorEntry = Array.isArray(authorRaw)
      ? (authorRaw[0] as Record<string, unknown>)
      : authorRaw;
    const nameRaw = authorEntry?.name;
    const author = Array.isArray(nameRaw) ? nameRaw[0] : nameRaw;
    const publishedRaw = entry.published;
    const published = Array.isArray(publishedRaw) ? publishedRaw[0] : publishedRaw;
    const updatedRaw = entry.updated;
    const updated = Array.isArray(updatedRaw) ? updatedRaw[0] : updatedRaw;

    return {
      eventType: updated ? "video_updated" : "video_published",
      videoId,
      channelId,
      title,
      link: link || `https://www.youtube.com/watch?v=${String(videoId ?? "")}`,
      author,
      publishedAt: published,
      updatedAt: updated,
    };
  }

  /**
   * Parse comment events
   */
  private async parseCommentEvent(
    comment: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
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
  private async parseChannelUpdateEvent(
    channelUpdate: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
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
  private async parseAnalyticsEvent(
    analytics: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
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
  private async findRelatedEntities(
    payload: Record<string, unknown>,
    normalizedData: Record<string, unknown>
  ) {
    // Extract channel ID from various sources
    let youtubeChannelId: string | undefined;
    let videoId: string | undefined;

    if (normalizedData.channelId) {
      youtubeChannelId = normalizedData.channelId as string;
    } else {
      const feed = payload.feed as Record<string, unknown> | undefined;
      if (feed?.["yt:channelId"]) {
        const raw = feed["yt:channelId"];
        youtubeChannelId = (Array.isArray(raw) ? raw[0] : raw) as string;
      }
    }

    if (normalizedData.videoId) {
      videoId = normalizedData.videoId as string;
    }

    // Find channel by YouTube channel ID via the dedicated `providerAccountId`
    // column. Webhook payloads use `channel_id` and `channelId` interchangeably;
    // both must be normalised to that column at OAuth-callback time.
    if (!youtubeChannelId) {
      return {};
    }
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "YOUTUBE",
        providerAccountId: youtubeChannelId,
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
  private async handleVideoPublished(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const postId = entities.postId as string | undefined;
    const channelId = entities.channelId as string | undefined;

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
            video_id: String(data.videoId ?? ""),
            title: String(data.title ?? ""),
            link: String(data.link ?? ""),
            published_at: String(data.publishedAt ?? ""),
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
          capturedAt: new Date((data.publishedAt ?? Date.now()) as string | number),
        },
      });
    }
  }

  /**
   * Handle video updated event
   */
  private async handleVideoUpdated(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const postId = entities.postId as string | undefined;
    const channelId = entities.channelId as string | undefined;

    if (postId && channelId) {
      // Update publish log with latest video metadata
      await prisma.publishLog.updateMany({
        where: {
          postId,
          channelId,
          provider: "YOUTUBE",
          payload: {
            path: ["video_id"],
            equals: data.videoId as string,
          },
        },
        data: {
          payload: {
            video_id: String(data.videoId ?? ""),
            title: String(data.title ?? ""),
            link: String(data.link ?? ""),
            updated_at: String(data.updatedAt ?? ""),
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
  private async handleCommentReceived(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const entityChannelId = entities.channelId as string | undefined;
    const entityPostId = entities.postId as string | undefined;

    // Create analytics entry for comment engagement
    if (entities.accountId && entities.projectId && data.videoId && entityChannelId) {
      // Find existing analytics record and increment comments
      const existing = await prisma.analytics.findFirst({
        where: {
          channelId: entityChannelId,
          provider: "YOUTUBE",
          postId: entityPostId || null,
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
        if (this.broadcaster && entityPostId) {
          await this.broadcaster.broadcastEngagementUpdate(
            entityPostId,
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
  private async handleChannelUpdated(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const entityChannelId = entities.channelId as string | undefined;

    if (entityChannelId) {
      // Channel metadata (title, description, subscriber/video/view counts)
      // used to be merged into the credentials JSON, conflating non-secret
      // statistics with the auth token envelope. With credentials now
      // encrypted at rest, this field is reserved for OAuth tokens only —
      // YouTube channel statistics need their own table or analytics
      // pipeline. Capture inputs silently for now.
      void data;
      void entityChannelId;
    }

    // Future: channel analytics tracking and account-level metrics aggregation
  }

  /**
   * Handle analytics update event
   */
  private async handleAnalyticsUpdate(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const entityChannelId = entities.channelId as string | undefined;
    const entityPostId = entities.postId as string | undefined;
    const views = Number(data.views ?? 0);
    const likes = Number(data.likes ?? 0);
    const comments = Number(data.comments ?? 0);
    const shares = Number(data.shares ?? 0);

    if (entities.accountId && entities.projectId && data.videoId && entityChannelId) {
      // Update or create analytics record
      const existing = await prisma.analytics.findFirst({
        where: {
          channelId: entityChannelId,
          provider: "YOUTUBE",
          postId: entityPostId || null,
        },
      });

      if (existing) {
        await prisma.analytics.update({
          where: { id: existing.id },
          data: {
            views,
            likes,
            comments,
            shares,
            capturedAt: new Date(data.timestamp as string | number),
          },
        });

        // Broadcast real-time analytics update
        if (this.broadcaster && entityPostId) {
          await this.broadcaster.broadcastEngagementUpdate(
            entityPostId,
            "YOUTUBE",
            { views, likes, comments, shares },
            {} // No incremental changes, just totals
          );
        }
      } else {
        await prisma.analytics.create({
          data: {
            channelId: entityChannelId,
            provider: "YOUTUBE",
            postId: entityPostId || null,
            views,
            likes,
            comments,
            shares,
            capturedAt: new Date(data.timestamp as string | number),
          },
        });
      }
    }

    // Future: revenue tracking and engagement prediction updates
  }
}
