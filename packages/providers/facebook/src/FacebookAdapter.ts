/**
 * @file FacebookAdapter.ts
 * @description Facebook provider adapter. Implements the ProviderAdapter port from
 *   @ports/core directly (no inheritance). Stateless w.r.t. credentials —
 *   credentials are passed per-call by the application layer. Routes content
 *   between regular page posts, Stories, and Reels via Graph API; supports
 *   page-level analytics, comment fetch, and reply posting.
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
  RenderedContent,
  RenderedPost,
  Result,
  RenderError,
  PublishError,
} from "@shared/types";
import { ok, err, AppError } from "@shared/types";
import {
  validateCredentialStructure,
  mapErrorToPublishError,
  type ProviderMetadata,
  type ProviderConstraints,
} from "@providers/shared";
import pino, { type Logger } from "pino";
import { FacebookApiClient, type FacebookCredentials } from "./apiClient.js";
import {
  FacebookStoriesApi,
  type FacebookStoryOptions,
  type FacebookStoryInteractiveElements,
} from "./features/stories.js";
import { FacebookReelsApi, type FacebookReelOptions } from "./features/reels.js";

const REQUIRED_FIELDS: (keyof FacebookCredentials)[] = [
  "accessToken",
  "pageId",
  "appId",
  "appSecret",
];

const FACEBOOK_LIMITS: ProviderLimits = {
  maxChars: 63206,
  allowedMedia: ["image", "video"],
  aspectRatios: ["16:9", "1:1", "4:5", "9:16"],
  maxMediaPerPost: 10,
  threadingSupported: false,
  rateLimitHints: { burst: 200, perSeconds: 3600 },
};

const FACEBOOK_METADATA: ProviderMetadata = {
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

const FACEBOOK_CAPABILITIES = {
  publish: true,
  mentions: true,
  schedule: true,
  analytics: true,
  comments: true,
  replies: true,
  threading: false,
};

/**
 * Factory for creating FacebookApiClient instances. Injected so tests can supply
 * a fake. Defaults to constructing a real `FacebookApiClient`.
 */
export type FacebookApiClientFactory = (credentials: FacebookCredentials) => FacebookApiClient;

const defaultClientFactory: FacebookApiClientFactory = (credentials) =>
  new FacebookApiClient(credentials);

export interface FacebookAdapterDeps {
  /** Logger instance. Default: pino at level "info". */
  logger?: Logger;
  /** Factory that constructs a FacebookApiClient given credentials. Default: real client. */
  apiClientFactory?: FacebookApiClientFactory;
}

/**
 * @class FacebookAdapter
 * @description Publishes content to Facebook via Graph API.
 */
export class FacebookAdapter implements ProviderAdapter {
  readonly id: ProviderId = "facebook";
  readonly limits: ProviderLimits = FACEBOOK_LIMITS;
  readonly capabilities = FACEBOOK_CAPABILITIES;
  readonly metadata: ProviderMetadata = FACEBOOK_METADATA;
  readonly constraints: ProviderConstraints = {};

  private readonly logger: Logger;
  private readonly apiClientFactory: FacebookApiClientFactory;

  constructor(deps: FacebookAdapterDeps = {}) {
    this.logger = deps.logger ?? pino({ name: "facebook-adapter", level: "info" });
    this.apiClientFactory = deps.apiClientFactory ?? defaultClientFactory;
  }

  /**
   * @method validateCredentials
   * @description Verifies that supplied credentials are well-formed and accepted
   *   by Facebook. Used by ConnectChannel before persisting a channel.
   */
  async validateCredentials(
    credentials: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const validation = validateCredentialStructure<FacebookCredentials>(
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
      await apiClient.validateCredentials();
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
   * @description Validates content length and renders for publishing.
   */
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
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
    });
  }

  /**
   * Detect content type based on post metadata and media.
   */
  private detectContentType(post: RenderedPost): "STORY" | "REEL" | "POST" {
    const contentType = post.meta?.contentType || post.meta?.type;
    if (contentType === "story" || contentType === "STORY") {
      return "STORY";
    }
    if (contentType === "reel" || contentType === "REEL") {
      return "REEL";
    }

    if (post.media && post.media.length > 0) {
      const firstMedia = post.media[0];
      if (!firstMedia) {
        return "POST";
      }

      if (post.meta?.ephemeral || post.meta?.story || post.meta?.duration === 24) {
        return "STORY";
      }

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

      if (
        firstMedia.type === "video" &&
        (post.meta?.musicTrack || post.meta?.effects || post.meta?.allowRemixing !== undefined)
      ) {
        return "REEL";
      }
    }

    return "POST";
  }

  /**
   * Publish a Facebook Story.
   */
  private async publishStory(
    credentials: FacebookCredentials,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    try {
      const storiesApi = new FacebookStoriesApi(credentials);

      if (!post.media || post.media.length === 0) {
        return err("VALIDATION");
      }

      const media = post.media[0];
      if (!media) {
        return err("VALIDATION");
      }

      const mediaMeta = (media as { meta?: Record<string, unknown> }).meta;

      const storyOptions: FacebookStoryOptions = {
        media: {
          id: "",
          mediaType: media.type === "video" ? "video" : "photo",
          url: media.url,
          ...(mediaMeta?.thumbnailUrl ? { thumbnailUrl: mediaMeta.thumbnailUrl as string } : {}),
        },
      };

      if (post.meta?.interactive) {
        storyOptions.interactive = post.meta.interactive as FacebookStoryInteractiveElements;
      }
      if (post.meta?.audienceRestriction) {
        storyOptions.audienceRestriction = post.meta.audienceRestriction as
          "everyone" | "friends" | "custom";
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
      return err(mapErrorToPublishError(error));
    }
  }

  /**
   * Publish a Facebook Reel.
   */
  private async publishReel(
    credentials: FacebookCredentials,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    try {
      const reelsApi = new FacebookReelsApi(credentials);

      if (!post.media || post.media.length === 0) {
        return err("VALIDATION");
      }

      const video = post.media[0];
      if (!video || video.type !== "video") {
        return err("VALIDATION");
      }

      const reelOptions: FacebookReelOptions = {
        videoUrl: video.url,
      };

      if (post.body) {
        reelOptions.description = post.body;
      }
      if (post.media[1]?.url) {
        reelOptions.coverImageUrl = post.media[1].url;
      }
      if (post.meta?.audienceRestriction) {
        reelOptions.audienceRestriction = post.meta.audienceRestriction as
          "public" | "friends" | "only_me";
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
      return err(mapErrorToPublishError(error));
    }
  }

  /**
   * Publish a regular Facebook page post.
   */
  private async publishPost(
    apiClient: FacebookApiClient,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    try {
      const mediaIds: string[] = [];
      if (post.media && post.media.length > 0) {
        for (const media of post.media) {
          const uploadResult = await apiClient.uploadMedia(media.url);
          mediaIds.push(uploadResult.id);
        }
      }

      const result = await apiClient.postToPage(post.body, mediaIds);

      return ok({
        providerPostId: result.id,
        url: `https://www.facebook.com/${result.id}`,
        publishedAt: new Date(),
      });
    } catch (error: unknown) {
      this.logError("publishPost", error, { post });
      return err(mapErrorToPublishError(error));
    }
  }

  /**
   * @method publish
   * @description Routes to Story, Reel, or regular Post based on detected
   *   content type. Caller must pass resolved credentials.
   */
  async publish(
    input: PublishInput,
    credentials: unknown
  ): Promise<Result<PublishReceipt, PublishError>> {
    const validation = validateCredentialStructure<FacebookCredentials>(
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
      const contentType = this.detectContentType(input.post);

      switch (contentType) {
        case "STORY":
          return await this.publishStory(validation.value, input.post);

        case "REEL":
          return await this.publishReel(validation.value, input.post);

        case "POST":
        default:
          return await this.publishPost(apiClient, input.post);
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
   * @method fetchAnalytics
   * @description Retrieves page-level insights for the given time window.
   */
  async fetchAnalytics(
    q: { channelId: string; since?: Date; until?: Date },
    credentials: unknown
  ): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const validation = validateCredentialStructure<FacebookCredentials>(
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

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err("NETWORK");
    }
  }

  /**
   * @method getComments
   * @description Fetches comments on a Facebook post via GET /{post-id}/comments.
   *   Supports cursor-based pagination and threading info.
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

    const validation = validateCredentialStructure<FacebookCredentials>(
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
   * @method fetchMentionById
   * @description Fetches a single object the page was tagged in (post or comment)
   *   by its provider id and normalizes it to ProviderMention. Drives the
   *   webhook-first listening path (fetch-before-process).
   * @param params - Resolved credentials and the provider mention id.
   * @returns Result with the normalized mention, or AUTH / NETWORK / NOT_FOUND.
   */
  async fetchMentionById(params: {
    channelCredentials: unknown;
    providerMentionId: string;
  }): Promise<Result<ProviderMention, "AUTH" | "NETWORK" | "NOT_FOUND">> {
    const validation = validateCredentialStructure<FacebookCredentials>(
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
      const obj = await apiClient.getMentionById(params.providerMentionId);

      const mention: ProviderMention = {
        providerMentionId: obj.id,
        authorName: obj.from?.name ?? "unknown",
        authorProviderId: obj.from?.id ?? "unknown",
        body: obj.message ?? obj.story ?? "",
        createdAt: obj.created_time ? new Date(obj.created_time) : new Date(),
        ...(obj.permalink_url ? { url: obj.permalink_url } : {}),
      };

      return ok(mention);
    } catch (error: unknown) {
      this.logError("fetchMentionById", error);
      if (error instanceof AppError) {
        if (error.statusCode === 401 || error.statusCode === 403) {
          return err("AUTH");
        }
        if (error.statusCode === 400 || error.statusCode === 404) {
          return err("NOT_FOUND");
        }
      }
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
    const validation = validateCredentialStructure<FacebookCredentials>(
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

      if (error instanceof Error && error.message?.includes("Rate Limit")) {
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
 * @function createFacebookAdapter
 * @description Factory used by the composition root to instantiate the adapter
 *   with explicit dependencies (logger, optional client factory for tests).
 */
export function createFacebookAdapter(deps: FacebookAdapterDeps = {}): FacebookAdapter {
  return new FacebookAdapter(deps);
}
