/**
 * @file SnapchatAdapter.ts
 * @description Snapchat provider adapter implementation. Extends AbstractProviderAdapter
 *              with Snapchat-specific functionality for publishing stories, uploading media,
 *              validating credentials, and fetching analytics.
 *              Snapchat does not support threading, scheduling, or comments.
 * @layer infrastructure
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
  ThreadPlan,
  ThreadPublishInput,
  ThreadReceipt,
  Result,
  RenderError,
  PublishError,
  ThreadError,
} from "@shared/types";
import { ok, err } from "@shared/types";
import { SnapchatApiClient } from "./apiClient.js";
import type { SnapchatCredentials } from "./types.js";

/**
 * @class SnapchatAdapter
 * @description Provider adapter for the Snapchat platform.
 *              Supports publishing stories with media, credential validation,
 *              and analytics retrieval. Threading and scheduling are not supported.
 */
export class SnapchatAdapter extends AbstractProviderAdapter<SnapchatCredentials> {
  readonly id: ProviderId = "snapchat";

  readonly metadata: ProviderMetadata = {
    id: "snapchat",
    name: "snapchat",
    displayName: "Snapchat",
    description: "Publish stories and spotlight content to Snapchat",
    icon: "/providers/snapchat-icon.svg",
    color: "#FFFC00",
    website: "https://www.snapchat.com",
    authType: "oauth",
    requiredScopes: ["snapchat-marketing-api", "snapchat-profile-api"],
    status: "active",
  };

  readonly constraints: ProviderConstraints = {
    businessAccountRequired: true,
  };

  readonly limits: ProviderLimits = {
    maxChars: 250,
    maxMediaPerPost: 1,
    allowedMedia: ["image", "video"],
    aspectRatios: ["9:16"],
    maxVideoDuration: 60,
    threadingSupported: false,
    rateLimitHints: { burst: 20, perSeconds: 1 },
  };

  readonly capabilities = {
    publish: true,
    schedule: false,
    analytics: true,
    comments: false,
    replies: false,
    threading: false,
    media: true,
    images: true,
    videos: true,
    stories: true,
  };

  protected readonly requiredCredentialFields: (keyof SnapchatCredentials)[] = [
    "clientId",
    "clientSecret",
    "accessToken",
    "refreshToken",
    "organizationId",
  ];

  // ============================================================
  // Abstract Method Implementations
  // ============================================================

  /**
   * @method getCredentialsFromEnvironment
   * @description Retrieves Snapchat credentials from environment variables.
   * @returns Result with credentials on success, "AUTH" error if placeholders detected
   */
  protected getCredentialsFromEnvironment(): Result<SnapchatCredentials, "AUTH"> {
    const credentials: SnapchatCredentials = {
      clientId: process.env.SNAPCHAT_CLIENT_ID || "placeholder",
      clientSecret: process.env.SNAPCHAT_CLIENT_SECRET || "placeholder",
      accessToken: process.env.SNAPCHAT_ACCESS_TOKEN || "placeholder",
      refreshToken: process.env.SNAPCHAT_REFRESH_TOKEN || "placeholder",
      organizationId: process.env.SNAPCHAT_ORGANIZATION_ID || "placeholder",
    };

    if (credentials.clientId === "placeholder" || credentials.accessToken === "placeholder") {
      return err("AUTH");
    }

    return ok(credentials);
  }

  /**
   * @method createApiClient
   * @description Creates a new SnapchatApiClient instance with the given credentials.
   * @param credentials - Snapchat OAuth credentials
   * @returns A configured SnapchatApiClient instance
   */
  protected createApiClient(credentials: SnapchatCredentials): SnapchatApiClient {
    return new SnapchatApiClient(credentials);
  }

  // ============================================================
  // Render
  // ============================================================

  /**
   * @method render
   * @description Renders a canonical post into Snapchat story format.
   *              Snapchat stories require media; text-only posts are not supported.
   *              Content is truncated to 250 characters if needed.
   * @param canonical - The platform-agnostic post to render
   * @returns Result with rendered content on success, RenderError on failure
   */
  override render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    // Snapchat requires media for stories
    if (!canonical.media || canonical.media.length === 0) {
      return err("VALIDATION_ERROR");
    }

    // Validate media type
    const firstMedia = canonical.media[0];
    if (!firstMedia) {
      return err("VALIDATION_ERROR");
    }

    if (!this.limits.allowedMedia.includes(firstMedia.type)) {
      return err("UNSUPPORTED_MEDIA");
    }

    // Truncate caption to Snapchat's limit
    const caption = canonical.body ? canonical.body.substring(0, this.limits.maxChars) : "";

    return ok({
      type: "single",
      content: {
        body: caption,
        text: caption,
        media: [
          {
            url: firstMedia.url,
            type: firstMedia.type,
            ...(firstMedia.alt && { alt: firstMedia.alt }),
          },
        ],
        meta: {
          contentType: "story",
          aspectRatio: "9:16",
          maxDuration: this.limits.maxVideoDuration,
        },
      },
      meta: {
        platform: "snapchat",
        storyFormat: true,
      },
    });
  }

  // ============================================================
  // Threading (not supported)
  // ============================================================

  /**
   * @method planThread
   * @description Snapchat does not support threading. Always returns an error.
   * @param _canonical - Unused canonical post
   * @returns Error result indicating threading is not supported
   */
  override planThread(_canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    return err("THREAD_PLANNING_FAILED");
  }

  /**
   * @method publishThread
   * @description Snapchat does not support threading. Always returns an error.
   * @param _input - Unused thread publish input
   * @returns Error result indicating threading is not supported
   */
  override async publishThread(
    _input: ThreadPublishInput
  ): Promise<Result<ThreadReceipt, PublishError>> {
    return err("VALIDATION");
  }

  // ============================================================
  // Publish
  // ============================================================

  /**
   * @method publish
   * @description Publishes a story to Snapchat. Uploads media first, then creates
   *              a creative/story referencing the uploaded media.
   * @param input - Publish input containing channel ID, rendered post, and dedupe key
   * @returns Result with publish receipt on success, PublishError on failure
   */
  override async publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>> {
    const credentials = await this.getCredentials(input.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);

      // Snapchat requires media - validate the rendered post has it
      if (!input.post.media || input.post.media.length === 0) {
        return err("VALIDATION");
      }

      const firstMedia = input.post.media[0];
      if (!firstMedia) {
        return err("VALIDATION");
      }

      // Step 1: Upload media
      const mediaResult = await apiClient.uploadMedia(
        firstMedia.url,
        firstMedia.type === "video" ? "video/mp4" : "image/jpeg"
      );

      // Step 2: Create story referencing the uploaded media
      const caption = input.post.body || input.post.text || "";
      const storyResult = await apiClient.createStory(mediaResult.media.id, caption || undefined);

      return ok({
        providerPostId: storyResult.creative.id,
        url: `https://www.snapchat.com/stories/${storyResult.creative.id}`,
        publishedAt: new Date(storyResult.creative.created_at),
      });
    } catch (error: unknown) {
      this.logError("publish", error, { channelId: input.channelId });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(this.mapErrorToPublishError(error));
    }
  }

  // ============================================================
  // Analytics
  // ============================================================

  /**
   * @method fetchAnalytics
   * @description Fetches analytics for a Snapchat story/creative.
   *              Uses the channelId as the creative ID for analytics lookup.
   * @param query - Analytics query with channelId, optional since/until dates
   * @returns Result with analytics data on success, error on failure
   */
  override async fetchAnalytics(query: {
    channelId: string;
    since?: Date;
    until?: Date;
  }): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const credentials = await this.getCredentials(query.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);
      const analytics = await apiClient.getStoryAnalytics(query.channelId);

      return ok({
        channelId: query.channelId,
        ...(query.since && { since: query.since }),
        ...(query.until && { until: query.until }),
        metrics: {
          views: analytics.total_views,
          uniqueViews: analytics.unique_views,
          likes: 0,
          shares: analytics.shares,
          comments: 0,
          screenshots: analytics.screenshots,
          swipeUps: analytics.swipe_ups,
          avgViewTime: analytics.avg_view_time_seconds,
        },
      });
    } catch (error: unknown) {
      this.logError("fetchAnalytics", error, { channelId: query.channelId });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err("NETWORK");
    }
  }
}

// Export singleton instance for backward compatibility
export const snapchatAdapter = new SnapchatAdapter();
