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
    allowedMedia: ["video"],
    aspectRatios: ["9:16", "1:1", "16:9"],
    maxMediaPerPost: 1, // TikTok allows one video per post
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

    // TikTok requires video media
    if (!canonical.media || canonical.media.length === 0) {
      return err("MEDIA_REQUIRED" as RenderError);
    }

    // Only one video allowed
    if (canonical.media.length > 1) {
      return err("TOO_MANY_MEDIA" as RenderError);
    }

    const videoMedia = canonical.media[0];
    if (!videoMedia || !videoMedia.url.includes("video")) {
      return err("INVALID_MEDIA_TYPE" as RenderError);
    }

    const mappedMedia = canonical.media
      ? canonical.media.map((media) => ({
          url: media.url,
          type:
            media.type === "video"
              ? ("video" as const)
              : media.type === "image"
                ? ("image" as const)
                : ("gif" as const),
          ...(media.alt && { alt: media.alt }),
        }))
      : undefined;

    return ok({
      type: "single" as const,
      content: {
        body: description,
        text: description,
        videoUrl: videoMedia.url,
        ...(mappedMedia && { media: mappedMedia }),
      },
      ...(Object.keys({}).length > 0 ? { meta: {} } : {}),
    });
  }

  /**
   * Generate and apply hashtag strategy
   */
  private async applyHashtagStrategy(
    apiClient: TikTokApiClient,
    credentials: TikTokCredentials,
    description: string,
    meta?: Record<string, any>
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
        contentCategory: meta.contentCategory || "general",
        ...(meta.targetAudience && { targetAudience: meta.targetAudience }),
        ...(meta.brandedHashtags && { brandedHashtags: meta.brandedHashtags }),
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
   */
  private async createPromotedContent(
    credentials: TikTokCredentials,
    videoId: string,
    meta?: Record<string, any>
  ): Promise<void> {
    if (!meta?.promotedContent || !meta?.marketingBudget) {
      return;
    }

    try {
      const marketingClient = this.marketingClientFactory
        ? this.marketingClientFactory({
            ...credentials,
            advertiserAccountId: process.env.TIKTOK_ADVERTISER_ACCOUNT_ID || "placeholder",
          })
        : new TikTokMarketingApiClient({
            clientKey: credentials.clientKey,
            clientSecret: credentials.clientSecret,
            accessToken: credentials.accessToken,
            openId: credentials.openId,
            advertiserAccountId: process.env.TIKTOK_ADVERTISER_ACCOUNT_ID || "placeholder",
          });

      // Note: This is a simplified example. The actual implementation would need
      // to create a full ad campaign with proper targeting and creative setup.
      // For now, we're using the Marketing API client to demonstrate the integration.
      await marketingClient.getAdAccount(); // Validate the marketing account exists

      // In a real implementation, you would create a campaign here with:
      // - Campaign creation with videoId
      // - Budget allocation
      // - Targeting based on demographics
      // This is left as placeholder for the full marketing integration
      this.logError(
        "createPromotedContent",
        new Error("Marketing campaign creation not fully implemented"),
        {
          videoId,
          budget: meta.marketingBudget,
        }
      );
    } catch (error) {
      this.logError("createPromotedContent", error, {});
      // Don't fail the publish if promotion fails
    }
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

      // TikTok requires video upload
      if (!input.post.media || input.post.media.length === 0) {
        return err("VALIDATION");
      }

      const videoMedia = input.post.media[0];
      if (!videoMedia) {
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
          input.post.meta
        );
      }

      // Future: Select trending sound if requested
      // Requires: TikTok Sound API endpoints (not available in public API)

      // Determine privacy level (only "public" or "private" are supported)
      let privacy: "public" | "private" = "public";
      if (input.post.meta?.privacy === "private") {
        privacy = "private";
      }

      // Upload video to TikTok with enhanced options
      const result = await apiClient.uploadVideo({
        description: enhancedDescription,
        videoUrl: videoMedia.url,
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
        this.createPromotedContent(credentials.value, result.shareId, input.post.meta).catch(
          (err) => this.logError("createPromotedContent", err, {})
        );
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
