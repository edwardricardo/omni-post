/**
 * TikTok Provider Adapter - Class-based implementation
 *
 * Extends AbstractProviderAdapter to provide TikTok-specific functionality
 * for publishing video content and fetching basic analytics.
 */

import {
  AbstractProviderAdapter,
  type ProviderMetadata,
  type ProviderConstraints,
} from "@providers/shared";
import type { ProviderId, ProviderLimits, PublishInput, PublishReceipt } from "@ports/core";
import type {
  CanonicalPost,
  RenderedContent,
  Result,
  RenderError,
  PublishError,
} from "@shared/types";
import { ok, err } from "@shared/types";
import { TikTokApiClient, type TikTokCredentials } from "./apiClient.js";
import { TikTokHashtagManager } from "./hashtagManager.js";
import { TikTokMarketingApiClient } from "./marketingApiClient.js";
import { TikTokResearchApiClient } from "./researchApiClient.js";

/**
 * Factory function types for dependency injection (testing)
 */
export type ResearchClientFactory = (
  credentials: TikTokCredentials & { researchApiKey: string }
) => TikTokResearchApiClient;

export type MarketingClientFactory = (
  credentials: TikTokCredentials & { advertiserAccountId: string }
) => TikTokMarketingApiClient;

export interface TikTokAdapterOptions {
  researchClientFactory?: ResearchClientFactory;
  marketingClientFactory?: MarketingClientFactory;
}

/**
 * TikTok Provider Adapter
 */
export class TikTokAdapter extends AbstractProviderAdapter<TikTokCredentials> {
  readonly id: ProviderId = "tiktok";

  // Private factories for dependency injection (undefined in production, set in tests)
  private readonly researchClientFactory?: ResearchClientFactory;
  private readonly marketingClientFactory?: MarketingClientFactory;

  /**
   * Constructor with optional dependency injection
   * @param options - Optional configuration for testing (factories)
   */
  constructor(options?: TikTokAdapterOptions) {
    super();
    // Use conditional assignment to comply with exactOptionalPropertyTypes
    if (options?.researchClientFactory) {
      this.researchClientFactory = options.researchClientFactory;
    }
    if (options?.marketingClientFactory) {
      this.marketingClientFactory = options.marketingClientFactory;
    }
  }

  readonly metadata: ProviderMetadata = {
    id: "tiktok",
    name: "tiktok",
    displayName: "TikTok",
    description: "Share short-form videos on TikTok",
    icon: "/providers/tiktok-icon.svg",
    color: "#000000",
    website: "https://tiktok.com",
    authType: "oauth",
    requiredScopes: ["video.upload", "user.info.basic"],
    status: "active",
  };

  readonly constraints: ProviderConstraints = {};

  readonly limits: ProviderLimits = {
    maxChars: 2200, // TikTok video description limit
    allowedMedia: ["video", "image"],
    aspectRatios: ["9:16", "1:1", "16:9"],
    maxMediaPerPost: 35, // TikTok allows up to 35 images per photo post, 1 video
    threadingSupported: false,
    rateLimitHints: { burst: 50, perSeconds: 3600 }, // TikTok API rate limits
  };

  readonly capabilities = {
    publish: true,
    schedule: false, // TikTok Content Posting API doesn't support scheduling
    analytics: true,
    comments: false, // Limited by API permissions
    replies: false,
    threading: false,
  };

  protected readonly requiredCredentialFields: (keyof TikTokCredentials)[] = [
    "clientKey",
    "clientSecret",
    "accessToken",
    "openId",
  ];

  /**
   * Get credentials from environment variables
   */
  protected getCredentialsFromEnvironment(): Result<TikTokCredentials, "AUTH"> {
    const credentials: TikTokCredentials = {
      clientKey: process.env.TIKTOK_CLIENT_KEY || "placeholder",
      clientSecret: process.env.TIKTOK_CLIENT_SECRET || "placeholder",
      accessToken: process.env.TIKTOK_ACCESS_TOKEN || "placeholder",
      openId: process.env.TIKTOK_OPEN_ID || "placeholder",
    };

    if (
      credentials.clientKey === "placeholder" ||
      credentials.clientSecret === "placeholder" ||
      credentials.accessToken === "placeholder" ||
      credentials.openId === "placeholder"
    ) {
      return err("AUTH");
    }

    return ok(credentials);
  }

  /**
   * Create TikTok API client
   */
  protected createApiClient(credentials: TikTokCredentials): TikTokApiClient {
    return new TikTokApiClient(credentials);
  }

  /**
   * Test credentials with TikTok API
   */
  protected override async testCredentials(apiClient: TikTokApiClient): Promise<void> {
    await apiClient.validateCredentials();
  }

  /**
   * Render canonical post for TikTok
   */
  override render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    // TikTok content is video with description
    const description = canonical.body;

    if (this.limits.maxChars && description.length > this.limits.maxChars) {
      return err("CONTENT_TOO_LONG");
    }

    // TikTok requires media (video or images)
    if (!canonical.media || canonical.media.length === 0) {
      return err("MEDIA_REQUIRED" as RenderError);
    }

    const firstMedia = canonical.media[0];
    if (!firstMedia) {
      return err("MEDIA_REQUIRED" as RenderError);
    }

    // Detect content type: photo post (all images) or video post (single video)
    const isPhotoPost = canonical.media.every((m) => m.type === "image");
    const isVideoPost = firstMedia.type === "video";

    if (!isPhotoPost && !isVideoPost) {
      return err("INVALID_MEDIA_TYPE" as RenderError);
    }

    // Video posts: only one video allowed
    if (isVideoPost && canonical.media.length > 1) {
      return err("TOO_MANY_MEDIA" as RenderError);
    }

    // Photo posts: max 35 images
    if (isPhotoPost && canonical.media.length > 35) {
      return err("TOO_MANY_MEDIA" as RenderError);
    }

    const mappedMedia = canonical.media.map((media) => ({
      url: media.url,
      type:
        media.type === "video"
          ? ("video" as const)
          : media.type === "image"
            ? ("image" as const)
            : ("gif" as const),
      ...(media.alt && { alt: media.alt }),
    }));

    return ok({
      type: "single" as const,
      content: {
        body: description,
        text: description,
        ...(isPhotoPost ? { contentType: "photo" } : { videoUrl: firstMedia.url }),
        media: mappedMedia,
      },
      ...(isPhotoPost ? { meta: { contentType: "photo" } } : {}),
    });
  }

  /**
   * Generate and apply hashtag strategy
   */
  /**
   * @method publishPhotoPost
   * @description Publishes a photo carousel post to TikTok.
   * @param apiClient - TikTok API client
   * @param credentials - TikTok credentials
   * @param post - The rendered post with image media
   * @param description - Enhanced description with hashtags
   */
  private async publishPhotoPost(
    apiClient: TikTokApiClient,
    credentials: TikTokCredentials,
    post: import("@shared/types").RenderedPost,
    description: string
  ): Promise<Result<PublishReceipt, PublishError>> {
    const imageUrls = (post.media || []).filter((m) => m.type === "image").map((m) => m.url);

    if (imageUrls.length === 0) {
      return err("VALIDATION");
    }

    const privacy =
      post.meta?.privacy === "private" ? ("SELF_ONLY" as const) : ("PUBLIC_TO_EVERYONE" as const);

    const result = await apiClient.publishPhotoPost({
      description,
      imageUrls,
      privacy,
      ...(typeof post.meta?.disableComment === "boolean" && {
        disableComment: post.meta.disableComment,
      }),
    });

    return ok({
      providerPostId: result.shareId,
      url:
        result.shareUrl || `https://www.tiktok.com/@${credentials.openId}/photo/${result.shareId}`,
      publishedAt: new Date(),
    });
  }

  private async applyHashtagStrategy(
    apiClient: TikTokApiClient,
    credentials: TikTokCredentials,
    description: string,
    meta?: Record<string, unknown>
  ): Promise<string> {
    if (!meta?.useHashtagStrategy) {
      return description;
    }

    try {
      const researchClient = this.researchClientFactory
        ? this.researchClientFactory({
            ...credentials,
            researchApiKey: process.env.TIKTOK_RESEARCH_API_KEY || "placeholder",
          })
        : new TikTokResearchApiClient({
            clientKey: credentials.clientKey,
            clientSecret: credentials.clientSecret,
            accessToken: credentials.accessToken,
            openId: credentials.openId,
            researchApiKey: process.env.TIKTOK_RESEARCH_API_KEY || "placeholder",
          });

      const hashtagManager = new TikTokHashtagManager(researchClient);

      const strategy = await hashtagManager.generateHashtagStrategy({
        contentCategory: (meta.contentCategory as string) || "general",
        ...(meta.targetAudience ? { targetAudience: meta.targetAudience as string } : {}),
        ...(meta.brandedHashtags ? { brandedHashtags: meta.brandedHashtags as string[] } : {}),
      });

      // Combine all hashtags from strategy
      const allHashtags = [
        ...strategy.strategy.primary,
        ...strategy.strategy.trending.slice(0, 3),
        ...strategy.strategy.niche.slice(0, 5),
      ];

      // Append hashtags to description
      const hashtagString = allHashtags.map((h) => `#${h}`).join(" ");
      return `${description}\n\n${hashtagString}`;
    } catch (error) {
      this.logError("applyHashtagStrategy", error, {});
      return description; // Fallback to original description
    }
  }

  // Future: selectTrendingSound
  // Select and attach a trending sound to the video before publishing.
  // Requires: TikTok Sound API endpoints (not available in public API).

  /**
   * Create promoted content via Marketing API
   * @deprecated NOT_IMPLEMENTED — TikTok Marketing API requires advertiser approval.
   * See docs/providers/tiktok.md for the approval process.
   */
  private async createPromotedContent(
    _credentials: TikTokCredentials,
    _videoId: string,
    _meta?: Record<string, unknown>
  ): Promise<void> {
    throw new Error(
      "NOT_IMPLEMENTED: TikTok Marketing API — TikTok Ads API requires advertiser account approval. See docs/providers/tiktok.md"
    );
  }

  /**
   * Publish video to TikTok
   */
  override async publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>> {
    // Get credentials using base class method
    const credentials = await this.getCredentials(input.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);

      // TikTok requires media
      if (!input.post.media || input.post.media.length === 0) {
        return err("VALIDATION");
      }

      const firstMedia = input.post.media[0];
      if (!firstMedia) {
        return err("VALIDATION");
      }

      const description = input.post.body || "";

      // Apply hashtag strategy if requested
      let enhancedDescription = description;
      if (input.post.meta) {
        enhancedDescription = await this.applyHashtagStrategy(
          apiClient,
          credentials.value,
          description,
          input.post.meta as Record<string, unknown>
        );
      }

      // Detect photo vs video post
      const isPhotoPost =
        input.post.meta?.contentType === "photo" ||
        input.post.media.every((m) => m.type === "image");

      if (isPhotoPost) {
        return await this.publishPhotoPost(
          apiClient,
          credentials.value,
          input.post,
          enhancedDescription
        );
      }

      // Determine privacy level (only "public" or "private" are supported)
      let privacy: "public" | "private" = "public";
      if (input.post.meta?.privacy === "private") {
        privacy = "private";
      }

      // Upload video to TikTok with enhanced options
      const result = await apiClient.uploadVideo({
        description: enhancedDescription,
        videoUrl: firstMedia.url,
        privacy,
        ...(typeof input.post.meta?.disableComment === "boolean" && {
          disableComment: input.post.meta.disableComment,
        }),
        ...(typeof input.post.meta?.disableDuet === "boolean" && {
          disableDuet: input.post.meta.disableDuet,
        }),
        ...(typeof input.post.meta?.disableStitch === "boolean" && {
          disableStitch: input.post.meta.disableStitch,
        }),
      });

      // Create promoted content if requested (async, don't wait)
      if (input.post.meta?.promotedContent) {
        this.createPromotedContent(
          credentials.value,
          result.shareId,
          input.post.meta as Record<string, unknown>
        ).catch((promoteErr) => this.logError("createPromotedContent", promoteErr, {}));
      }

      return ok({
        providerPostId: result.shareId,
        url:
          result.shareUrl ||
          `https://www.tiktok.com/@${credentials.value.openId}/video/${result.shareId}`,
        publishedAt: new Date(),
      });
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
   * Fetch analytics from TikTok
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
      const analytics = await apiClient.getUserInfo();

      // TikTok API provides limited analytics for user videos
      return ok({
        channelId: q.channelId,
        period: { since: q.since, until: q.until },
        metrics: {
          impressions: analytics.followerCount || 0,
          engagements: analytics.likesCount + analytics.followingCount || 0,
          likes: analytics.likesCount || 0,
          shares: 0, // Not available in basic API
          comments: 0, // Not available in basic API
          clicks: analytics.videoCount || 0,
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
}

// Export singleton instance for backward compatibility
export const tiktokAdapter = new TikTokAdapter();
