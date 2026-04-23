/**
 * @file YouTubeAdapter.ts
 * @description YouTube provider adapter extending AbstractProviderAdapter with video publishing,
 *              media upload, and analytics retrieval for the YouTube Data API.
 * @layer infrastructure
 */

import {
  AbstractProviderAdapter,
  type ProviderMetadata,
  type ProviderConstraints,
} from "@providers/shared";
import type {
  ProviderId,
  ProviderLimits,
  PublishInput,
  PublishReceipt,
  ProviderComment,
  ProviderReplyResult,
} from "@ports/core";
import type {
  CanonicalPost,
  RenderedContent,
  RenderedPost,
  Result,
  RenderError,
  PublishError,
} from "@shared/types";
import { ok, err } from "@shared/types";
import { YouTubeApiClient, type YouTubeCredentials } from "./apiClient.js";
import { YouTubeShortsService } from "./shorts.js";
import { YouTubeLiveStreamingService } from "./liveStreaming.js";

/**
 * YouTube Provider Adapter
 * Handles video uploads, channel analytics, and content validation
 */
export class YouTubeAdapter extends AbstractProviderAdapter<YouTubeCredentials> {
  readonly id: ProviderId = "youtube";

  readonly metadata: ProviderMetadata = {
    id: "youtube",
    name: "youtube",
    displayName: "YouTube",
    description: "Upload videos, shorts and community posts to YouTube",
    icon: "/providers/youtube-icon.svg",
    color: "#FF0000",
    website: "https://youtube.com",
    authType: "oauth",
    requiredScopes: ["youtube.upload", "youtube.readonly"],
    status: "active",
  };

  readonly constraints: ProviderConstraints = {};

  readonly limits: ProviderLimits = {
    maxChars: 5000, // YouTube video description limit
    allowedMedia: ["video"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    maxMediaPerPost: 1, // YouTube allows one video per upload
    threadingSupported: false,
    rateLimitHints: { burst: 100, perSeconds: 3600 }, // YouTube API quota
  };

  readonly capabilities = {
    publish: true,
    schedule: true,
    analytics: true,
    comments: true,
    replies: true,
    threading: false,
    communityPosts: false,
  };

  protected readonly requiredCredentialFields: (keyof YouTubeCredentials)[] = [
    "clientId",
    "clientSecret",
    "refreshToken",
    "channelId",
  ];

  /**
   * Get credentials from environment variables
   */
  protected getCredentialsFromEnvironment(): Result<YouTubeCredentials, "AUTH"> {
    const credentials: YouTubeCredentials = {
      clientId: process.env.YOUTUBE_CLIENT_ID || "placeholder",
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET || "placeholder",
      refreshToken: process.env.YOUTUBE_REFRESH_TOKEN || "placeholder",
      channelId: process.env.YOUTUBE_CHANNEL_ID || "placeholder",
      ...(process.env.YOUTUBE_ACCESS_TOKEN && {
        accessToken: process.env.YOUTUBE_ACCESS_TOKEN,
      }),
    };

    if (
      credentials.clientId === "placeholder" ||
      credentials.clientSecret === "placeholder" ||
      credentials.refreshToken === "placeholder" ||
      credentials.channelId === "placeholder"
    ) {
      return err("AUTH");
    }

    return ok(credentials);
  }

  /**
   * Create YouTube API client
   */
  protected createApiClient(credentials: YouTubeCredentials): YouTubeApiClient {
    return new YouTubeApiClient(credentials);
  }

  /**
   * Test credentials by validating channel access
   */
  protected override async testCredentials(apiClient: YouTubeApiClient): Promise<void> {
    await apiClient.validateCredentials();
  }

  /**
   * Render canonical post for YouTube
   * YouTube content requires video media
   */
  override render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    const description = canonical.body;

    // Check description length
    if (this.limits.maxChars && description.length > this.limits.maxChars) {
      return err("CONTENT_TOO_LONG");
    }

    // YouTube requires video media
    if (!canonical.media || canonical.media.length === 0) {
      return err("VALIDATION_ERROR" as RenderError);
    }

    // Only one video allowed per upload
    if (canonical.media.length > 1) {
      return err("VALIDATION_ERROR" as RenderError);
    }

    const videoMedia = canonical.media[0];
    if (!videoMedia || videoMedia.type !== "video") {
      return err("UNSUPPORTED_MEDIA" as RenderError);
    }

    // Extract title from first line or use default
    const titleMatch = canonical.body.split("\n")[0];
    const title = titleMatch && titleMatch.length > 0 ? titleMatch : "Untitled Video";

    return ok({
      type: "single",
      content: {
        body: description,
        title,
        description,
        videoUrl: videoMedia.url,
        ...(canonical.media && canonical.media.length > 0 ? { media: canonical.media } : {}),
      },
      ...(Object.keys({}).length > 0 ? { meta: {} } : {}),
    });
  }

  /**
   * Detect YouTube content type based on post metadata and media characteristics
   */
  private detectContentType(
    post: RenderedPost
  ): "SHORT" | "COMMUNITY_POST" | "LIVE_STREAM" | "VIDEO" {
    // Check for explicit content type in metadata
    const contentType = post.meta?.contentType || post.meta?.type;
    if (contentType === "short" || contentType === "SHORT") {
      return "SHORT";
    }
    if (contentType === "community" || contentType === "COMMUNITY_POST") {
      return "COMMUNITY_POST";
    }
    if (contentType === "live" || contentType === "LIVE_STREAM") {
      return "LIVE_STREAM";
    }

    // Detect based on media characteristics
    if (post.media && post.media.length > 0) {
      const firstMedia = post.media[0];
      if (!firstMedia) {
        return "COMMUNITY_POST"; // No media = community post
      }

      // Shorts: vertical video (9:16 aspect ratio) with duration ≤ 60 seconds
      // Short-form metadata is on post.meta (RenderedMedia has no meta field)
      if (
        firstMedia.type === "video" &&
        (post.meta?.aspectRatio === "9:16" || post.meta?.isShort) &&
        (post.meta?.durationSeconds === undefined ||
          (typeof post.meta?.durationSeconds === "number" && post.meta.durationSeconds <= 60))
      ) {
        return "SHORT";
      }

      // Live stream: video with live streaming metadata
      if (
        firstMedia.type === "video" &&
        (post.meta?.isLive || post.meta?.streamKey || post.meta?.scheduledStartTime)
      ) {
        return "LIVE_STREAM";
      }

      // Default video content
      return "VIDEO";
    }

    // No media and no video = community post (text/images only)
    return "COMMUNITY_POST";
  }

  /**
   * Publish YouTube Short
   */
  private async publishShort(
    apiClient: YouTubeApiClient,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    try {
      // Access credentials from apiClient
      const credentials = apiClient.credentials;
      const shortsService = new YouTubeShortsService(credentials);

      // Validate video exists for short
      if (!post.media || post.media.length === 0) {
        return err("VALIDATION");
      }

      const video = post.media[0];
      if (!video || video.type !== "video") {
        return err("VALIDATION");
      }

      // Extract metadata from post
      const title = (post.meta?.title as string) || post.body.split("\n")[0] || "Untitled Short";
      const description = post.body || "";
      const tags = (post.meta?.tags as string[]) || [];
      const privacy = (post.meta?.privacy as "public" | "private" | "unlisted") || "public";
      const categoryId = (post.meta?.categoryId as string) || "24"; // Entertainment

      // Build shorts upload request
      const shortResponse = await shortsService.uploadShort({
        title,
        description,
        videoUrl: video.url,
        privacy,
        tags,
        categoryId,
        ...(post.media[1]?.url && { thumbnailUrl: post.media[1].url }),
      });

      return ok({
        providerPostId: shortResponse.id,
        url: `https://www.youtube.com/shorts/${shortResponse.id}`,
        publishedAt: new Date(shortResponse.publishedAt),
      });
    } catch (error: unknown) {
      this.logError("publishShort", error, { post });
      return err(this.mapErrorToPublishError(error));
    }
  }

  /**
   * Publish YouTube Community Post
   * @deprecated OUT OF SCOPE: YouTube Community Tab API requires YouTube Partner Program.
   * Not available via standard Data API v3. See capabilities.communityPosts = false.
   */
  private async publishCommunityPost(
    _apiClient: YouTubeApiClient,
    _post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    // OUT OF SCOPE: YouTube Community Tab API requires YouTube Partner Program.
    // Not available via standard Data API v3. Callers should check
    // capabilities.communityPosts before attempting to publish community posts.
    return err("VALIDATION");
  }

  /**
   * Publish YouTube Live Stream
   */
  private async publishLiveStream(
    apiClient: YouTubeApiClient,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    try {
      // Access credentials from apiClient
      const credentials = apiClient.credentials;
      const liveService = new YouTubeLiveStreamingService(credentials);

      // Extract live stream configuration from metadata
      const title =
        (post.meta?.title as string) || post.body.split("\n")[0] || "Untitled Live Stream";
      const description = post.body || "";
      const privacy = (post.meta?.privacy as "public" | "private" | "unlisted") || "public";
      const tags = (post.meta?.tags as string[]) || [];
      const categoryId = post.meta?.categoryId as string;
      const scheduledStartTime = post.meta?.scheduledStartTime
        ? new Date(post.meta.scheduledStartTime as string)
        : undefined;
      const enableAutoStart = post.meta?.enableAutoStart as boolean | undefined;
      const enableAutoStop = post.meta?.enableAutoStop as boolean | undefined;
      const enableDvr = post.meta?.enableDvr as boolean | undefined;
      const enableEmbed = post.meta?.enableEmbed as boolean | undefined;
      const recordFromStart = post.meta?.recordFromStart as boolean | undefined;
      const latencyPreference = post.meta?.latencyPreference as
        | "normal"
        | "low"
        | "ultraLow"
        | undefined;

      // Create live stream
      const liveStream = await liveService.createLiveStream({
        title,
        description,
        privacy,
        tags,
        ...(categoryId && { categoryId }),
        ...(scheduledStartTime && { scheduledStartTime }),
        ...(enableAutoStart !== undefined && { enableAutoStart }),
        ...(enableAutoStop !== undefined && { enableAutoStop }),
        ...(enableDvr !== undefined && { enableDvr }),
        ...(enableEmbed !== undefined && { enableEmbed }),
        ...(recordFromStart !== undefined && { recordFromStart }),
        ...(latencyPreference && { latencyPreference }),
      });

      return ok({
        providerPostId: liveStream.id,
        url: `https://www.youtube.com/watch?v=${liveStream.id}`,
        publishedAt: scheduledStartTime || new Date(),
      });
    } catch (error: unknown) {
      this.logError("publishLiveStream", error, { post });
      return err(this.mapErrorToPublishError(error));
    }
  }

  /**
   * Publish regular video to YouTube
   */
  private async publishVideo(
    apiClient: YouTubeApiClient,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    try {
      // Validate video media
      if (!post.media || post.media.length === 0) {
        return err("VALIDATION");
      }

      const videoMedia = post.media[0];
      if (!videoMedia) {
        return err("VALIDATION");
      }

      // Extract title and description
      const titleMatch = post.body.split("\n")[0];
      const title = titleMatch && titleMatch.length > 0 ? titleMatch : "Untitled Video";
      const description = post.body || "";

      // Upload video to YouTube with circuit breaker protection
      const result = await apiClient.uploadVideo({
        title,
        description,
        videoUrl: videoMedia.url,
        privacy: "public", // Default to public, could be configurable
        tags: [], // Could extract from description or metadata
      });

      return ok({
        providerPostId: result.id,
        url: `https://www.youtube.com/watch?v=${result.id}`,
        publishedAt: new Date(result.publishedAt),
      });
    } catch (error: unknown) {
      this.logError("publishVideo", error, { post });
      return err(this.mapErrorToPublishError(error));
    }
  }

  /**
   * Publish content to YouTube (routes to Short, Community Post, Live Stream, or regular Video)
   */
  override async publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>> {
    // Get credentials using base class method
    const credentials = await this.getCredentials(input.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);

      // Detect content type based on post metadata and media
      const contentType = this.detectContentType(input.post);

      // Route to appropriate publishing method
      switch (contentType) {
        case "SHORT":
          return await this.publishShort(apiClient, input.post);

        case "COMMUNITY_POST":
          return await this.publishCommunityPost(apiClient, input.post);

        case "LIVE_STREAM":
          return await this.publishLiveStream(apiClient, input.post);

        case "VIDEO":
        default:
          return await this.publishVideo(apiClient, input.post);
      }
    } catch (error: unknown) {
      this.logError("publish", error, { channelId: input.channelId });

      // Handle circuit breaker specific error
      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(this.mapErrorToPublishError(error));
    }
  }

  /**
   * Fetch analytics from YouTube
   */
  override async fetchAnalytics(q: {
    channelId: string;
    since?: Date;
    until?: Date;
  }): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const credentials = await this.getCredentials(q.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);
      const analytics = await apiClient.getChannelAnalytics(q.since, q.until);

      return ok({
        channelId: q.channelId,
        period: { since: q.since, until: q.until },
        metrics: {
          impressions: analytics.views || 0,
          engagements: (analytics.likes || 0) + (analytics.comments || 0),
          likes: analytics.likes || 0,
          shares: analytics.shares || 0,
          comments: analytics.comments || 0,
          clicks: analytics.subscribersGained || 0,
          views: analytics.views || 0,
          watchTime: analytics.watchTime || 0,
        },
      });
    } catch (error: unknown) {
      this.logError("fetchAnalytics", error, { channelId: q.channelId });

      // Handle circuit breaker specific error
      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err("NETWORK");
    }
  }

  /**
   * @method getComments
   * @description Fetches comments for a YouTube video via commentThreads.list.
   * @param params - channelCredentials, postExternalId, cursor, limit
   * @returns Paginated list of ProviderComment objects
   */
  async getComments(params: {
    channelCredentials: YouTubeCredentials;
    postExternalId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Result<{ comments: ProviderComment[]; nextCursor?: string }, "AUTH" | "NETWORK">> {
    if (!params.postExternalId) {
      return ok({ comments: [] });
    }

    try {
      const apiClient = this.createApiClient(params.channelCredentials);
      const response = await apiClient.getVideoComments(
        params.postExternalId,
        params.limit || 20,
        params.cursor
      );

      const comments: ProviderComment[] = response.items.map((item) => {
        const snippet = item.snippet.topLevelComment.snippet;
        return {
          providerMessageId: item.snippet.topLevelComment.id,
          authorName: snippet.authorDisplayName,
          authorProviderId: snippet.authorChannelId?.value || "",
          ...(snippet.authorProfileImageUrl
            ? { authorAvatarUrl: snippet.authorProfileImageUrl }
            : {}),
          body: snippet.textDisplay,
          createdAt: new Date(snippet.publishedAt),
        };
      });

      return ok({
        comments,
        ...(response.nextPageToken ? { nextCursor: response.nextPageToken } : {}),
      });
    } catch (error: unknown) {
      this.logError("getComments", error, { videoId: params.postExternalId });
      if (error instanceof Error) {
        if (error.message.includes("401") || error.message.includes("403")) return err("AUTH");
      }
      return err("NETWORK");
    }
  }

  /**
   * @method postReply
   * @description Posts a reply to a YouTube comment via comments.insert.
   * @param params - channelCredentials, inReplyToProviderMessageId, body, postExternalId
   * @returns The new reply ID and creation timestamp
   */
  async postReply(params: {
    channelCredentials: YouTubeCredentials;
    inReplyToProviderMessageId: string;
    body: string;
    postExternalId?: string;
  }): Promise<Result<ProviderReplyResult, "AUTH" | "NETWORK" | "RATE_LIMIT">> {
    try {
      const apiClient = this.createApiClient(params.channelCredentials);
      const result = await apiClient.postComment(
        params.postExternalId || "",
        params.body,
        params.inReplyToProviderMessageId
      );

      return ok({
        providerReplyId: result.id,
        createdAt: new Date(result.publishedAt),
      });
    } catch (error: unknown) {
      this.logError("postReply", error, { parentId: params.inReplyToProviderMessageId });
      if (error instanceof Error) {
        if (error.message.includes("401") || error.message.includes("403")) return err("AUTH");
        if (error.message.includes("429") || error.message.toLowerCase().includes("rate"))
          return err("RATE_LIMIT");
      }
      return err("NETWORK");
    }
  }
}

// Export singleton instance for backward compatibility
export const youtubeAdapter = new YouTubeAdapter();
