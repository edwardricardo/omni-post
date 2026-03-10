/**
 * Facebook Provider Adapter - Class-based implementation
 *
 * Extends AbstractProviderAdapter to provide Facebook-specific functionality
 * for publishing posts, uploading media, and fetching page analytics.
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
import { FacebookApiClient, type FacebookCredentials } from "./apiClient.js";
import {
  FacebookStoriesApi,
  type FacebookStoryOptions,
  type FacebookStoryInteractiveElements,
} from "./features/stories.js";
import { FacebookReelsApi, type FacebookReelOptions } from "./features/reels.js";

/**
 * Facebook Provider Adapter
 */
export class FacebookAdapter extends AbstractProviderAdapter<FacebookCredentials> {
  readonly id: ProviderId = "facebook";

  readonly metadata: ProviderMetadata = {
    id: "facebook",
    name: "facebook",
    displayName: "Facebook",
    description: "Publish posts, stories and videos to Facebook",
    icon: "/providers/facebook-icon.svg",
    color: "#1877F2",
    website: "https://facebook.com",
    authType: "oauth",
    requiredScopes: ["pages_manage_posts", "pages_read_engagement"],
    status: "active",
  };

  readonly constraints: ProviderConstraints = {};

  readonly limits: ProviderLimits = {
    maxChars: 63206, // Facebook's character limit
    allowedMedia: ["image", "video"],
    aspectRatios: ["16:9", "1:1", "4:5", "9:16"],
    maxMediaPerPost: 10, // Facebook allows multiple media per post
    threadingSupported: false, // Facebook doesn't support threading like Twitter
    rateLimitHints: { burst: 200, perSeconds: 3600 }, // Facebook rate limits
  };

  readonly capabilities = {
    publish: true,
    schedule: true,
    analytics: true,
    comments: true,
    replies: true,
    threading: false,
  };

  protected readonly requiredCredentialFields: (keyof FacebookCredentials)[] = [
    "accessToken",
    "pageId",
    "appId",
    "appSecret",
  ];

  /**
   * Get credentials from environment variables
   */
  protected getCredentialsFromEnvironment(): Result<FacebookCredentials, "AUTH"> {
    const credentials: FacebookCredentials = {
      accessToken: process.env.FACEBOOK_ACCESS_TOKEN || "placeholder",
      pageId: process.env.FACEBOOK_PAGE_ID || "placeholder",
      appId: process.env.FACEBOOK_APP_ID || "placeholder",
      appSecret: process.env.FACEBOOK_APP_SECRET || "placeholder",
      ...(process.env.FACEBOOK_LONG_LIVED_TOKEN && {
        longLivedToken: process.env.FACEBOOK_LONG_LIVED_TOKEN,
      }),
      ...(process.env.FACEBOOK_INSTAGRAM_BUSINESS_ACCOUNT_ID && {
        instagramBusinessAccountId: process.env.FACEBOOK_INSTAGRAM_BUSINESS_ACCOUNT_ID,
      }),
      ...(process.env.FACEBOOK_AD_ACCOUNT_ID && {
        adAccountId: process.env.FACEBOOK_AD_ACCOUNT_ID,
      }),
    };

    if (
      credentials.accessToken === "placeholder" ||
      credentials.pageId === "placeholder" ||
      credentials.appId === "placeholder" ||
      credentials.appSecret === "placeholder"
    ) {
      return err("AUTH");
    }

    return ok(credentials);
  }

  /**
   * Create Facebook API client
   */
  protected createApiClient(credentials: FacebookCredentials): FacebookApiClient {
    return new FacebookApiClient(credentials);
  }

  /**
   * Render canonical post for Facebook
   */
  override render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    // Facebook posts are single posts, no threading
    const message = canonical.body;

    if (this.limits.maxChars && message.length > this.limits.maxChars) {
      return err("CONTENT_TOO_LONG");
    }

    return ok({
      type: "single",
      content: {
        body: message,
        message,
        ...(canonical.media && canonical.media.length > 0 ? { media: canonical.media } : {}),
      },
      ...(Object.keys({}).length > 0 ? { meta: {} } : {}),
    });
  }

  /**
   * Detect content type based on post metadata and media
   */
  private detectContentType(post: RenderedPost): "STORY" | "REEL" | "POST" {
    // Check for explicit content type in metadata
    const contentType = post.meta?.contentType || post.meta?.type;
    if (contentType === "story" || contentType === "STORY") {
      return "STORY";
    }
    if (contentType === "reel" || contentType === "REEL") {
      return "REEL";
    }

    // Detect based on media characteristics
    if (post.media && post.media.length > 0) {
      const firstMedia = post.media[0];
      if (!firstMedia) {
        return "POST";
      }

      // Stories: typically vertical video/image with short lifespan metadata
      if (post.meta?.ephemeral || post.meta?.story || post.meta?.duration === 24) {
        return "STORY";
      }

      // Reels: vertical video content (9:16 aspect ratio)
      const mediaMeta = (firstMedia as { meta?: Record<string, unknown> }).meta;
      if (
        firstMedia.type === "video" &&
        (mediaMeta?.aspectRatio === "9:16" ||
          post.meta?.aspectRatio === "9:16" ||
          mediaMeta?.isReel ||
          post.meta?.isReel)
      ) {
        return "REEL";
      }

      // Reels: video with reel-specific metadata
      if (
        firstMedia.type === "video" &&
        (post.meta?.musicTrack || post.meta?.effects || post.meta?.allowRemixing !== undefined)
      ) {
        return "REEL";
      }
    }

    // Default to regular post
    return "POST";
  }

  /**
   * Publish story to Facebook
   */
  private async publishStory(
    apiClient: FacebookApiClient,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    try {
      const storiesApi = new FacebookStoriesApi(apiClient["credentials"]);

      // Validate media exists for story
      if (!post.media || post.media.length === 0) {
        return err("VALIDATION");
      }

      const media = post.media[0];
      if (!media) {
        return err("VALIDATION");
      }

      const mediaMeta = (media as { meta?: Record<string, unknown> }).meta;

      // Build story options
      const storyOptions: FacebookStoryOptions = {
        media: {
          id: "",
          mediaType: media.type === "video" ? "video" : "photo",
          url: media.url,
          ...(mediaMeta?.thumbnailUrl ? { thumbnailUrl: mediaMeta.thumbnailUrl as string } : {}),
        },
      };

      // Add optional story properties from post metadata
      if (post.meta?.interactive) {
        storyOptions.interactive = post.meta.interactive as FacebookStoryInteractiveElements;
      }
      if (post.meta?.audienceRestriction) {
        storyOptions.audienceRestriction = post.meta.audienceRestriction as
          | "everyone"
          | "friends"
          | "custom";
      }
      if (post.meta?.customAudience) {
        storyOptions.customAudience = post.meta.customAudience as string[];
      }
      if (post.meta?.locationTag) {
        storyOptions.locationTag = post.meta.locationTag as {
          placeId: string;
          coordinateX?: number;
          coordinateY?: number;
        };
      }
      if (post.meta?.allowResharing !== undefined) {
        storyOptions.allowResharing = post.meta.allowResharing as boolean;
      }
      if (post.meta?.hideFromTimeline !== undefined) {
        storyOptions.hideFromTimeline = post.meta.hideFromTimeline as boolean;
      }

      const storyResponse = await storiesApi.createStory(storyOptions);

      return ok({
        providerPostId: storyResponse.id,
        url: storyResponse.permalink || `https://www.facebook.com/stories/${storyResponse.id}`,
        publishedAt: new Date(storyResponse.createdTime),
      });
    } catch (error: unknown) {
      this.logError("publishStory", error, { post });
      return err(this.mapErrorToPublishError(error));
    }
  }

  /**
   * Publish reel to Facebook
   */
  private async publishReel(
    apiClient: FacebookApiClient,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    try {
      const reelsApi = new FacebookReelsApi(apiClient["credentials"]);

      // Validate video exists for reel
      if (!post.media || post.media.length === 0) {
        return err("VALIDATION");
      }

      const video = post.media[0];
      if (!video || video.type !== "video") {
        return err("VALIDATION");
      }

      // Build reel options
      const reelOptions: FacebookReelOptions = {
        videoUrl: video.url,
      };

      // Add optional reel properties
      if (post.body) {
        reelOptions.description = post.body;
      }
      if (post.media[1]?.url) {
        reelOptions.coverImageUrl = post.media[1].url;
      }
      if (post.meta?.audienceRestriction) {
        reelOptions.audienceRestriction = post.meta.audienceRestriction as
          | "public"
          | "friends"
          | "only_me";
      }
      if (post.meta?.allowComments !== undefined) {
        reelOptions.allowComments = post.meta.allowComments as boolean;
      }
      if (post.meta?.allowSharing !== undefined) {
        reelOptions.allowSharing = post.meta.allowSharing as boolean;
      }
      if (post.meta?.allowRemixing !== undefined) {
        reelOptions.allowRemixing = post.meta.allowRemixing as boolean;
      }
      if (post.meta?.locationTag) {
        reelOptions.locationTag = post.meta.locationTag as { placeId: string; placeName?: string };
      }
      if (post.meta?.hashtags) {
        reelOptions.hashtags = post.meta.hashtags as string[];
      }
      if (post.meta?.mentions) {
        reelOptions.mentions = post.meta.mentions as Array<{ userId: string; username: string }>;
      }
      if (post.meta?.musicTrack) {
        reelOptions.musicTrack = post.meta.musicTrack as {
          trackId: string;
          startTime?: number;
          duration?: number;
        };
      }
      if (post.meta?.effects) {
        reelOptions.effects = post.meta.effects as Array<{ effectId: string; effectName: string }>;
      }
      if (post.meta?.scheduledPublishTime) {
        reelOptions.scheduledPublishTime = new Date(
          post.meta.scheduledPublishTime as string | number
        );
      }
      if (post.meta?.crossPostToInstagram !== undefined) {
        reelOptions.crossPostToInstagram = post.meta.crossPostToInstagram as boolean;
      }

      const reelResponse = await reelsApi.createReel(reelOptions);

      return ok({
        providerPostId: reelResponse.id,
        url: reelResponse.permalink,
        publishedAt: new Date(reelResponse.createdTime),
      });
    } catch (error: unknown) {
      this.logError("publishReel", error, { post });
      return err(this.mapErrorToPublishError(error));
    }
  }

  /**
   * Publish regular post to Facebook
   */
  private async publishPost(
    apiClient: FacebookApiClient,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    try {
      // Upload media first if present
      const mediaIds: string[] = [];
      if (post.media && post.media.length > 0) {
        for (const media of post.media) {
          const uploadResult = await apiClient.uploadMedia(media.url);
          mediaIds.push(uploadResult.id);
        }
      }

      // Post to Facebook Page with circuit breaker protection
      const result = await apiClient.postToPage(post.body, mediaIds);

      return ok({
        providerPostId: result.id,
        url: `https://www.facebook.com/${result.id}`,
        publishedAt: new Date(),
      });
    } catch (error: unknown) {
      this.logError("publishPost", error, { post });
      return err(this.mapErrorToPublishError(error));
    }
  }

  /**
   * Publish post to Facebook (routes to Story, Reel, or regular Post based on content type)
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
        case "STORY":
          return await this.publishStory(apiClient, input.post);

        case "REEL":
          return await this.publishReel(apiClient, input.post);

        case "POST":
        default:
          return await this.publishPost(apiClient, input.post);
      }
    } catch (error: unknown) {
      this.logError("publish", error, { channelId: input.channelId });

      // Handle circuit breaker specific error
      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      // Use base class error mapping
      return err(this.mapErrorToPublishError(error));
    }
  }

  /**
   * Fetch analytics from Facebook
   */
  override async fetchAnalytics(q: {
    channelId: string;
    since?: Date;
    until?: Date;
  }): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    // Get credentials using base class method
    const credentials = await this.getCredentials(q.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);
      const insights = await apiClient.getPageInsights(q.since, q.until);

      return ok({
        channelId: q.channelId,
        period: { since: q.since, until: q.until },
        metrics: {
          impressions: insights.impressions || 0,
          engagements: insights.engagements || 0,
          likes: insights.likes || 0,
          shares: insights.shares || 0,
          comments: insights.comments || 0,
          clicks: insights.clicks || 0,
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
  // ----------------------------------------------------------
  // Social Inbox: getComments & postReply
  // ----------------------------------------------------------

  /**
   * @method getComments
   * @description Fetches comments on a Facebook post via GET /{post-id}/comments.
   *              Supports cursor-based pagination and reverse chronological order.
   */
  async getComments(params: {
    channelCredentials: unknown;
    postExternalId?: string;
    since?: Date;
    cursor?: string;
    limit?: number;
  }): Promise<Result<{ comments: ProviderComment[]; nextCursor?: string }, "AUTH" | "NETWORK">> {
    if (!params.postExternalId) {
      return ok({ comments: [] });
    }

    try {
      const credentials = params.channelCredentials as FacebookCredentials;
      const apiClient = this.createApiClient(credentials);

      const result = await apiClient.getPostComments(
        params.postExternalId,
        params.limit || 25,
        params.cursor
      );

      const comments: ProviderComment[] = result.data.map((c) => ({
        providerMessageId: c.id,
        authorName: c.from.name,
        authorProviderId: c.from.id,
        body: c.message,
        createdAt: new Date(c.created_time),
        ...(c.parent ? { providerParentId: c.parent.id } : {}),
      }));

      return ok({
        comments,
        ...(result.paging?.cursors?.after ? { nextCursor: result.paging.cursors.after } : {}),
      });
    } catch (error: unknown) {
      this.logError("getComments", error);
      return err("NETWORK");
    }
  }

  /**
   * @method postReply
   * @description Posts a reply to a Facebook comment via POST /{comment-id}/comments.
   */
  async postReply(params: {
    channelCredentials: unknown;
    inReplyToProviderMessageId: string;
    body: string;
  }): Promise<Result<ProviderReplyResult, "AUTH" | "NETWORK" | "RATE_LIMIT">> {
    try {
      const credentials = params.channelCredentials as FacebookCredentials;
      const apiClient = this.createApiClient(credentials);

      const result = await apiClient.replyToComment(params.inReplyToProviderMessageId, params.body);

      return ok({
        providerReplyId: result.id,
        createdAt: new Date(),
      });
    } catch (error: unknown) {
      this.logError("postReply", error);

      if (error instanceof Error && error.message?.includes("Rate Limit")) {
        return err("RATE_LIMIT");
      }

      return err("NETWORK");
    }
  }
}

// Export singleton instance for backward compatibility
export const facebookAdapter = new FacebookAdapter();
