/**
 * @file InstagramAdapter.ts
 * @description Instagram provider adapter. Implements the ProviderAdapter port from
 *   @ports/core directly (no inheritance). Stateless w.r.t. credentials —
 *   credentials are passed per-call by the application layer. Routes content
 *   between feed posts, carousels, Stories, and Reels via Instagram Graph API
 *   container-then-publish pattern; supports user-level analytics, comment
 *   fetch (with threaded replies), and reply posting.
 * @layer infrastructure
 */

import type {
  ProviderAdapter,
  ProviderId,
  ProviderLimits,
  PublishInput,
  PublishReceipt,
  ProviderComment,
  ProviderMention,
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
import {
  validateCredentialStructure,
  mapErrorToPublishError,
  type ProviderMetadata,
  type ProviderConstraints,
} from "@providers/shared";
import pino, { type Logger } from "pino";
import { InstagramApiClient, type InstagramCredentials } from "./apiClient.js";
import { InstagramMediaProcessor } from "./mediaProcessor.js";
import {
  detectContentType,
  shouldCreateCarousel,
  optimizeInstagramContent,
  optimizeHashtags,
  planCarousel,
} from "./contentHelpers.js";

const REQUIRED_FIELDS: (keyof InstagramCredentials)[] = ["accessToken", "userId"];

const INSTAGRAM_LIMITS: ProviderLimits = {
  maxChars: 2200,
  maxHashtags: 30,
  allowedMedia: ["image", "video"],
  aspectRatios: ["1:1", "4:5", "9:16", "16:9"],
  maxPostsPerThread: 20,
  maxMediaPerPost: 20,
  threadingSupported: true,
  rateLimitHints: { burst: 25, perSeconds: 86400 },
};

const INSTAGRAM_METADATA: ProviderMetadata = {
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

const INSTAGRAM_CAPABILITIES = {
  publish: true,
  mentions: true,
  schedule: false,
  analytics: true,
  comments: true,
  replies: true,
  threading: true,
};

const INSTAGRAM_CONSTRAINTS: ProviderConstraints = {
  businessAccountRequired: true,
};

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

/**
 * Factory for creating InstagramApiClient instances. Injected so tests can
 * supply a fake. Defaults to constructing a real `InstagramApiClient`.
 */
export type InstagramApiClientFactory = (credentials: InstagramCredentials) => InstagramApiClient;

const defaultClientFactory: InstagramApiClientFactory = (credentials) =>
  new InstagramApiClient(credentials);

const defaultMediaProcessorFactory = (): InstagramMediaProcessor => new InstagramMediaProcessor();

export interface InstagramAdapterDeps {
  /** Logger instance. Default: pino at level "info". */
  logger?: Logger;
  /** Factory that constructs an InstagramApiClient given credentials. Default: real client. */
  apiClientFactory?: InstagramApiClientFactory;
  /** Media processor used for Reels validation/optimization. Default: real processor. */
  mediaProcessor?: InstagramMediaProcessor;
}

/**
 * @class InstagramAdapter
 * @description Publishes content to Instagram via Graph API.
 */
export class InstagramAdapter implements ProviderAdapter {
  readonly id: ProviderId = "instagram";
  readonly limits: ProviderLimits = INSTAGRAM_LIMITS;
  readonly capabilities = INSTAGRAM_CAPABILITIES;
  readonly metadata: ProviderMetadata = INSTAGRAM_METADATA;
  readonly constraints: ProviderConstraints = INSTAGRAM_CONSTRAINTS;

  private readonly logger: Logger;
  private readonly apiClientFactory: InstagramApiClientFactory;
  private readonly mediaProcessor: InstagramMediaProcessor;

  constructor(deps: InstagramAdapterDeps = {}) {
    this.logger = deps.logger ?? pino({ name: "instagram-adapter", level: "info" });
    this.apiClientFactory = deps.apiClientFactory ?? defaultClientFactory;
    this.mediaProcessor = deps.mediaProcessor ?? defaultMediaProcessorFactory();
  }

  /**
   * @method validateCredentials
   * @description Verifies that supplied credentials are well-formed and
   *   the underlying account is BUSINESS or CREATOR (Instagram API requirement).
   */
  async validateCredentials(
    credentials: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const validation = validateCredentialStructure<InstagramCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH_INVALID");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);
      const userInfo = await apiClient.validateCredentials();

      if (userInfo.account_type === "PERSONAL") {
        return err("AUTH_INVALID");
      }
      return ok(undefined);
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "validateCredentials",
        error: error instanceof Error ? error.message : String(error),
      });
      if (
        error instanceof Error &&
        "status" in error &&
        (error as Record<string, unknown>).status === 401
      ) {
        return err("AUTH_EXPIRED");
      }
      return err("AUTH_INVALID");
    }
  }

  /**
   * @method render
   * @description Renders canonical post for Instagram, switching between
   *   single feed post and carousel based on length / media count.
   */
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
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
    }

    const optimizedContent = optimizeInstagramContent(canonical.body);
    const optimizedHashtags = optimizeHashtags(canonical.body);

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
    });
  }

  /**
   * @method planThread
   * @description Plans a carousel as Instagram's threading equivalent.
   */
  planThread(canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    return planCarousel(canonical, this.limits);
  }

  /**
   * @method publish
   * @description Routes to feed, carousel, story, or reel publishing based on
   *   detected content type. Caller must pass resolved credentials.
   */
  async publish(
    input: PublishInput,
    credentials: unknown
  ): Promise<Result<PublishReceipt, PublishError>> {
    const validation = validateCredentialStructure<InstagramCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);
      const post = input.post;

      const contentType = detectContentType(post);

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

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(mapErrorToPublishError(error));
    }
  }

  /**
   * Publish a regular feed post.
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

    await waitForContainer(apiClient, container.id);

    const result = await apiClient.publishMedia(container.id);

    return ok({
      providerPostId: result.id,
      url: result.permalink,
      publishedAt: new Date(result.timestamp),
    });
  }

  /**
   * Publish an Instagram Story.
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

    const container = await apiClient.createStoriesContainer(media.url, mediaType);

    await waitForContainer(apiClient, container.id);

    const result = await apiClient.publishMedia(container.id);

    return ok({
      providerPostId: result.id,
      url: result.permalink,
      publishedAt: new Date(result.timestamp),
    });
  }

  /**
   * Publish an Instagram Reel.
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

    const validationResult = await this.mediaProcessor.validateVideo(media.url, "REELS");
    if (!validationResult.valid) {
      this.logError(
        "publishReel",
        new Error(`Video validation failed: ${validationResult.issues.join(", ")}`),
        {}
      );
      return err("VALIDATION");
    }

    const optimizedVideoUrl = await this.mediaProcessor.optimizeForReels(media.url);

    const caption = post.text || post.body;

    const container = await apiClient.createReelsContainer(optimizedVideoUrl, caption, true, true);

    await waitForContainer(apiClient, container.id, 180000);

    const result = await apiClient.publishMedia(container.id);

    return ok({
      providerPostId: result.id,
      url: result.permalink,
      publishedAt: new Date(result.timestamp),
    });
  }

  /**
   * Publish an Instagram Carousel.
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

    await waitForContainer(apiClient, container.id);

    const result = await apiClient.publishMedia(container.id);

    return ok({
      providerPostId: result.id,
      url: result.permalink,
      publishedAt: new Date(result.timestamp),
    });
  }

  /**
   * @method publishThread
   * @description Publishes a thread plan as a carousel post.
   */
  async publishThread(
    input: ThreadPublishInput,
    credentials: unknown
  ): Promise<Result<ThreadReceipt, PublishError>> {
    const validation = validateCredentialStructure<InstagramCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);
      const threadPlan = input.threadPlan;

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

      const mainCaption = threadPlan.tweets[0]?.text || "";

      const container = await apiClient.createCarouselContainer(carouselItems, mainCaption);

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
        totalTweets: 1,
      };

      return ok(receipt);
    } catch (error: unknown) {
      this.logError("publishThread", error, { channelId: input.channelId });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(mapErrorToPublishError(error));
    }
  }

  /**
   * @method fetchAnalytics
   * @description Retrieves user-level insights and recent media engagement.
   */
  async fetchAnalytics(
    q: { channelId: string; since?: Date; until?: Date },
    credentials: unknown
  ): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const validation = validateCredentialStructure<InstagramCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);

      const userInsights = await apiClient.getUserInsights(
        ["impressions", "reach", "profile_views"],
        "days_28",
        q.since,
        q.until
      );

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

  /**
   * @method getComments
   * @description Fetches comments on an Instagram media post via
   *   GET /{media-id}/comments. Includes threaded replies via field expansion.
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

    const validation = validateCredentialStructure<InstagramCredentials>(
      params.channelCredentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);

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
   * @method fetchMentionById
   * @description Fetches a single media object the account was @mentioned in by
   *   its provider id and normalizes it to ProviderMention. Drives the
   *   webhook-first listening path (fetch-before-process).
   * @param params - Resolved credentials and the provider mention id.
   * @returns Result with the normalized mention, or AUTH / NETWORK / NOT_FOUND.
   */
  async fetchMentionById(params: {
    channelCredentials: unknown;
    providerMentionId: string;
  }): Promise<Result<ProviderMention, "AUTH" | "NETWORK" | "NOT_FOUND">> {
    const validation = validateCredentialStructure<InstagramCredentials>(
      params.channelCredentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);
      const media = await apiClient.getMentionById(params.providerMentionId);

      const mention: ProviderMention = {
        providerMentionId: media.id,
        authorName: media.username ?? "unknown",
        authorProviderId: media.username ?? "unknown",
        body: media.caption ?? "",
        createdAt: media.timestamp ? new Date(media.timestamp) : new Date(),
        ...(media.username ? { authorHandle: media.username } : {}),
        ...(media.permalink ? { url: media.permalink } : {}),
        ...(media.media_url ? { mediaUrls: [media.media_url] } : {}),
      };

      return ok(mention);
    } catch (error: unknown) {
      this.logError("fetchMentionById", error);
      const status =
        error instanceof Error && "status" in error
          ? (error as Record<string, unknown>).status
          : undefined;
      if (status === 401 || status === 403) {
        return err("AUTH");
      }
      if (status === 400 || status === 404) {
        return err("NOT_FOUND");
      }
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
    const validation = validateCredentialStructure<InstagramCredentials>(
      params.channelCredentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);

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

  private logError(operation: string, error: unknown, context: Record<string, unknown> = {}): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error({
      provider: this.id,
      operation,
      error: errorMessage,
      ...context,
    });
  }
}

/**
 * @function createInstagramAdapter
 * @description Factory used by the composition root to instantiate the adapter
 *   with explicit dependencies (logger, optional client factory and media
 *   processor for tests).
 */
export function createInstagramAdapter(deps: InstagramAdapterDeps = {}): InstagramAdapter {
  return new InstagramAdapter(deps);
}
