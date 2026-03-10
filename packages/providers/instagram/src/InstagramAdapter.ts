/**
 * @file InstagramAdapter.ts
 * @description Instagram provider adapter. Extends AbstractProviderAdapter to
 *              publish posts, carousels, stories, reels, and handle comments.
 *              Content helpers extracted to contentHelpers.ts for maintainability.
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
  RenderedPost,
  RenderedContent,
  ThreadPlan,
  ThreadPublishInput,
  ThreadReceipt,
  Result,
  RenderError,
  PublishError,
  ThreadError,
} from "@shared/types";
import { ok, err, AppError } from "@shared/types";
import { InstagramApiClient, type InstagramCredentials } from "./apiClient.js";
import { InstagramMediaProcessor } from "./mediaProcessor.js";
import {
  detectContentType,
  shouldCreateCarousel,
  optimizeInstagramContent,
  optimizeHashtags,
  planCarousel,
} from "./contentHelpers.js";

/**
 * @function waitForContainer
 * @description Polls Instagram container status until FINISHED or ERROR.
 */
async function waitForContainer(
  apiClient: InstagramApiClient,
  containerId: string,
  timeout = 60000
): Promise<void> {
  const maxAttempts = Math.floor(timeout / 1000);
  const delay = 1000;

  for (let i = 0; i < maxAttempts; i++) {
    const status = await apiClient.getContainerStatus(containerId);

    if (status.status === "FINISHED") {
      return;
    }

    if (status.status === "ERROR") {
      throw AppError.externalService("instagram", `Media container failed: ${status.status_code}`);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw AppError.externalService("instagram", "Media container timeout");
}

// ============================================================
// Instagram Adapter Class
// ============================================================

export class InstagramAdapter extends AbstractProviderAdapter<InstagramCredentials> {
  readonly id: ProviderId = "instagram";
  private readonly mediaProcessor: InstagramMediaProcessor;

  constructor() {
    super();
    this.mediaProcessor = new InstagramMediaProcessor();
  }

  readonly metadata: ProviderMetadata = {
    id: "instagram",
    name: "instagram",
    displayName: "Instagram",
    description: "Share photos, videos, stories and reels on Instagram",
    icon: "/providers/instagram-icon.svg",
    color: "#E4405F",
    website: "https://instagram.com",
    authType: "oauth",
    requiredScopes: ["instagram_basic", "instagram_content_publish"],
    status: "active",
  };

  readonly constraints: ProviderConstraints = {
    businessAccountRequired: true,
  };

  readonly limits: ProviderLimits = {
    maxChars: 2200, // Instagram caption limit
    maxHashtags: 30, // Instagram allows up to 30 hashtags per post
    allowedMedia: ["image", "video"],
    aspectRatios: ["1:1", "4:5", "9:16", "16:9"], // Instagram supported ratios
    maxPostsPerThread: 20, // Carousel limit (Instagram's threading equivalent)
    maxMediaPerPost: 20, // Maximum items in carousel
    threadingSupported: true, // Via carousels
    rateLimitHints: { burst: 25, perSeconds: 86400 }, // 25 posts per day
  };

  readonly capabilities = {
    publish: true,
    schedule: false, // Instagram Graph API doesn't support scheduling
    analytics: true,
    comments: true,
    replies: true,
    threading: true, // Via carousels
  };
  protected readonly requiredCredentialFields: (keyof InstagramCredentials)[] = [
    "accessToken",
    "userId",
  ];

  protected getCredentialsFromEnvironment(): Result<InstagramCredentials, "AUTH"> {
    const credentials: InstagramCredentials = {
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || "placeholder",
      userId: process.env.INSTAGRAM_USER_ID || "placeholder",
      ...(process.env.INSTAGRAM_APP_ID && { appId: process.env.INSTAGRAM_APP_ID }),
      ...(process.env.INSTAGRAM_APP_SECRET && { appSecret: process.env.INSTAGRAM_APP_SECRET }),
    };

    if (credentials.accessToken === "placeholder" || credentials.userId === "placeholder") {
      return err("AUTH");
    }

    return ok(credentials);
  }

  protected createApiClient(credentials: InstagramCredentials): InstagramApiClient {
    return new InstagramApiClient(credentials);
  }

  protected override async testCredentials(apiClient: InstagramApiClient): Promise<void> {
    const userInfo = await apiClient.validateCredentials();

    // Check if it's a Business or Creator account (required for API access)
    if (userInfo.account_type === "PERSONAL") {
      throw AppError.badRequest("Instagram API requires Business or Creator account");
    }
  }

  /**
   * Render canonical post for Instagram
   * Handles both single posts and carousels
   */
  override render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    // Instagram handles "threading" via carousels, so we need to adapt the concept
    const useCarousel = shouldCreateCarousel(canonical);

    if (useCarousel) {
      const carouselPlan = planCarousel(canonical, this.limits);

      if (!carouselPlan.ok) {
        return err("CONTENT_TOO_LONG");
      }

      return ok({
        type: "thread",
        content: carouselPlan.value,
        meta: {
          postType: "carousel",
          estimatedReach: carouselPlan.value.estimatedReach,
        },
      });
    } else {
      // Single post
      const optimizedContent = optimizeInstagramContent(canonical.body);
      const optimizedHashtags = optimizeHashtags(canonical.body);

      // Combine content and hashtags
      const finalContent = `${optimizedContent}\n\n${optimizedHashtags}`.trim();

      if (this.limits.maxChars && finalContent.length > this.limits.maxChars) {
        return err("CONTENT_TOO_LONG");
      }

      return ok({
        type: "single",
        content: {
          body: finalContent,
          text: finalContent,
          ...(canonical.media && canonical.media.length > 0 ? { media: canonical.media } : {}),
          meta: {
            postType: "feed",
            mediaType: canonical.media?.[0]?.type === "video" ? "video" : "image",
          },
        },
        ...(Object.keys({}).length > 0 ? { meta: {} } : {}),
      });
    }
  }

  /**
   * Plan thread for Instagram (carousel)
   */
  override planThread(canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    // For Instagram, "threading" means carousel posts
    return planCarousel(canonical, this.limits);
  }

  /**
   * Publish single post, carousel, story, or reel to Instagram
   */
  override async publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>> {
    const credentials = await this.getCredentials(input.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);
      const post = input.post;

      // Detect content type
      const contentType = detectContentType(post);

      // Route to appropriate publishing method based on content type
      switch (contentType) {
        case "STORY":
          return await this.publishStory(apiClient, post);

        case "REEL":
          return await this.publishReel(apiClient, post);

        case "CAROUSEL":
          return await this.publishCarousel(apiClient, post);

        case "FEED":
        default:
          return await this.publishFeedPost(apiClient, post);
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
   * Publish a regular feed post
   */
  private async publishFeedPost(
    apiClient: InstagramApiClient,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    const mediaUrl = post.media?.[0]?.url;
    const mediaType = post.media?.[0]?.type === "video" ? "VIDEO" : "IMAGE";

    if (!mediaUrl) {
      return err("VALIDATION");
    }

    const caption = post.text || post.body;
    const container = await apiClient.createMediaContainer(mediaUrl, caption, mediaType);

    // Wait for container to be ready
    await waitForContainer(apiClient, container.id);

    const result = await apiClient.publishMedia(container.id);

    return ok({
      providerPostId: result.id,
      url: result.permalink,
      publishedAt: new Date(result.timestamp),
    });
  }

  /**
   * Publish an Instagram Story
   */
  private async publishStory(
    apiClient: InstagramApiClient,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    if (!post.media || post.media.length === 0) {
      return err("VALIDATION");
    }

    const media = post.media[0];
    if (!media) {
      return err("VALIDATION");
    }

    const mediaType = media.type === "video" ? "VIDEO" : "IMAGE";

    // Create Stories container
    const container = await apiClient.createStoriesContainer(media.url, mediaType);

    // Wait for container to be ready
    await waitForContainer(apiClient, container.id);

    // Publish the story
    const result = await apiClient.publishMedia(container.id);

    return ok({
      providerPostId: result.id,
      url: result.permalink,
      publishedAt: new Date(result.timestamp),
    });
  }

  /**
   * Publish an Instagram Reel
   */
  private async publishReel(
    apiClient: InstagramApiClient,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    if (!post.media || post.media.length !== 1 || post.media[0]?.type !== "video") {
      return err("VALIDATION");
    }

    const media = post.media[0];
    if (!media) {
      return err("VALIDATION");
    }

    // Validate video for Reels (max 90 seconds)
    const validationResult = await this.mediaProcessor.validateVideo(media.url, "REELS");
    if (!validationResult.valid) {
      this.logError(
        "publishReel",
        new Error(`Video validation failed: ${validationResult.issues.join(", ")}`),
        {}
      );
      return err("VALIDATION");
    }

    // Optimize video if needed
    const optimizedVideoUrl = await this.mediaProcessor.optimizeForReels(media.url);

    const caption = post.text || post.body;

    // Create Reels container
    const container = await apiClient.createReelsContainer(
      optimizedVideoUrl,
      caption,
      true, // shareToFeed
      true // enableRemixing
    );

    // Wait for container to be ready (Reels may take longer to process)
    await waitForContainer(apiClient, container.id, 180000); // 3 minutes timeout

    // Publish the reel
    const result = await apiClient.publishMedia(container.id);

    return ok({
      providerPostId: result.id,
      url: result.permalink,
      publishedAt: new Date(result.timestamp),
    });
  }

  /**
   * Publish an Instagram Carousel
   */
  private async publishCarousel(
    apiClient: InstagramApiClient,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    if (!post.media || post.media.length < 2 || post.media.length > 10) {
      return err("VALIDATION");
    }

    const carouselItems = post.media.map((media: { url: string; type: string }) => ({
      media_type: (media.type === "video" ? "VIDEO" : "IMAGE") as "IMAGE" | "VIDEO",
      media_url: media.url,
    }));

    const caption = post.text || post.body;
    const container = await apiClient.createCarouselContainer(carouselItems, caption);

    // Wait for container to be ready
    await waitForContainer(apiClient, container.id);

    const result = await apiClient.publishMedia(container.id);

    return ok({
      providerPostId: result.id,
      url: result.permalink,
      publishedAt: new Date(result.timestamp),
    });
  }

  /**
   * Publish thread (carousel) to Instagram
   */
  override async publishThread(
    input: ThreadPublishInput
  ): Promise<Result<ThreadReceipt, PublishError>> {
    const credentials = await this.getCredentials(input.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);
      const threadPlan = input.threadPlan;

      // Create carousel items from thread slides
      const carouselItems = threadPlan.tweets.map((tweet, index) => {
        const media = tweet.media?.[0];
        if (!media?.url) {
          throw AppError.badRequest(
            `Instagram carousel slide ${index + 1} is missing a required media URL. All carousel slides must include an image or video.`
          );
        }
        return {
          media_type: (media.type === "video" ? "VIDEO" : "IMAGE") as "IMAGE" | "VIDEO",
          media_url: media.url,
        };
      });

      // Use the first slide's text as the main caption
      const mainCaption = threadPlan.tweets[0]?.text || "";

      const container = await apiClient.createCarouselContainer(carouselItems, mainCaption);

      // Wait for container to be ready
      await waitForContainer(apiClient, container.id);

      const result = await apiClient.publishMedia(container.id);

      const receipt: ThreadReceipt = {
        threadId: input.dedupeKey,
        tweets: [
          {
            sequence: 1,
            providerTweetId: result.id,
            url: result.permalink,
            publishedAt: new Date(result.timestamp),
          },
        ],
        totalTweets: 1, // Carousel counts as one post
      };

      return ok(receipt);
    } catch (error: unknown) {
      this.logError("publishThread", error, { channelId: input.channelId });

      // Handle circuit breaker specific error
      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(this.mapErrorToPublishError(error));
    }
  }

  /**
   * Fetch analytics from Instagram
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

      // Get user insights
      const userInsights = await apiClient.getUserInsights(
        ["impressions", "reach", "profile_views"],
        "days_28",
        q.since,
        q.until
      );

      // Get recent media for additional metrics
      const userMedia = await apiClient.getUserMedia(10);

      const mediaMetrics = {
        totalPosts: userMedia.data.length,
        totalLikes: userMedia.data.reduce((sum, media) => sum + (media.like_count || 0), 0),
        totalComments: userMedia.data.reduce((sum, media) => sum + (media.comments_count || 0), 0),
      };

      return ok({
        channelId: q.channelId,
        period: { since: q.since, until: q.until },
        metrics: {
          impressions:
            userInsights.data.find((d) => d.name === "impressions")?.values[0]?.value || 0,
          reach: userInsights.data.find((d) => d.name === "reach")?.values[0]?.value || 0,
          profileViews:
            userInsights.data.find((d) => d.name === "profile_views")?.values[0]?.value || 0,
          likes: mediaMetrics.totalLikes,
          comments: mediaMetrics.totalComments,
          posts: mediaMetrics.totalPosts,
        },
      });
    } catch (error: unknown) {
      this.logError("fetchAnalytics", error, { channelId: q.channelId });
      return err("NETWORK");
    }
  }
  // ----------------------------------------------------------
  // Social Inbox: getComments & postReply
  // ----------------------------------------------------------

  /**
   * @method getComments
   * @description Fetches comments on an Instagram media post via GET /{media-id}/comments.
   *              Includes threaded replies via field expansion.
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
      const credentials = params.channelCredentials as InstagramCredentials;
      const apiClient = this.createApiClient(credentials);

      const result = await apiClient.getMediaComments(
        params.postExternalId,
        params.limit || 50,
        params.cursor
      );

      const comments: ProviderComment[] = [];

      for (const c of result.data) {
        comments.push({
          providerMessageId: c.id,
          authorName: c.username,
          authorProviderId: c.username,
          body: c.text,
          createdAt: new Date(c.timestamp),
        });

        // Include threaded replies
        if (c.replies?.data) {
          for (const reply of c.replies.data) {
            comments.push({
              providerMessageId: reply.id,
              providerParentId: c.id,
              authorName: reply.username,
              authorProviderId: reply.username,
              body: reply.text,
              createdAt: new Date(reply.timestamp),
            });
          }
        }
      }

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
   * @description Posts a reply to a comment via POST /{comment-id}/replies.
   */
  async postReply(params: {
    channelCredentials: unknown;
    inReplyToProviderMessageId: string;
    body: string;
  }): Promise<Result<ProviderReplyResult, "AUTH" | "NETWORK" | "RATE_LIMIT">> {
    try {
      const credentials = params.channelCredentials as InstagramCredentials;
      const apiClient = this.createApiClient(credentials);

      const result = await apiClient.replyToComment(params.inReplyToProviderMessageId, params.body);

      return ok({
        providerReplyId: result.id,
        createdAt: new Date(),
      });
    } catch (error: unknown) {
      this.logError("postReply", error);

      if (error instanceof Error && error.message?.includes("429")) {
        return err("RATE_LIMIT");
      }

      return err("NETWORK");
    }
  }
}

// Export singleton instance for backward compatibility
export const instagramAdapter = new InstagramAdapter();
