/**
 * @file YouTubeAdapter.ts
 * @description YouTube provider adapter. Implements the ProviderAdapter port from
 *   @ports/core directly (no inheritance). Stateless w.r.t. credentials —
 *   credentials are passed per-call by the application layer. Routes a rendered
 *   post to the appropriate publishing flow (Shorts, Live Stream, Community Post,
 *   or regular Video) based on metadata + media characteristics, and surfaces
 *   YouTube comments/replies through the inbox port.
 * @layer infrastructure
 */

import type {
  ProviderAdapter,
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
import {
  validateCredentialStructure,
  mapErrorToPublishError,
  type ProviderMetadata,
  type ProviderConstraints,
} from "@providers/shared";
import pino, { type Logger } from "pino";
import { YouTubeApiClient, type YouTubeCredentials } from "./apiClient.js";
import { YouTubeShortsService } from "./shorts.js";
import { YouTubeLiveStreamingService } from "./liveStreaming.js";

export interface YouTubeProviderCredentials extends YouTubeCredentials {
  [key: string]: string | undefined;
}

const REQUIRED_FIELDS: (keyof YouTubeProviderCredentials)[] = [
  "clientId",
  "clientSecret",
  "refreshToken",
  "channelId",
];

const YOUTUBE_LIMITS: ProviderLimits = {
  maxChars: 5000,
  allowedMedia: ["video"],
  aspectRatios: ["16:9", "9:16", "1:1"],
  maxMediaPerPost: 1,
  threadingSupported: false,
  rateLimitHints: { burst: 100, perSeconds: 3600 },
};

const YOUTUBE_METADATA: ProviderMetadata = {
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

const YOUTUBE_CAPABILITIES = {
  publish: true,
  schedule: true,
  analytics: true,
  comments: true,
  replies: true,
  threading: false,
  communityPosts: false,
};

/**
 * Factory for creating YouTubeApiClient instances. Injected so tests can supply
 * a fake. Defaults to constructing a real `YouTubeApiClient`.
 */
export type YouTubeApiClientFactory = (credentials: YouTubeCredentials) => YouTubeApiClient;

const defaultApiClientFactory: YouTubeApiClientFactory = (credentials) =>
  new YouTubeApiClient(credentials);

export interface YouTubeAdapterDeps {
  /** Logger instance. Default: pino at level "info". */
  logger?: Logger;
  /** Factory that constructs a YouTubeApiClient given credentials. Default: real client. */
  apiClientFactory?: YouTubeApiClientFactory;
}

/**
 * @class YouTubeAdapter
 * @description Publishes content to YouTube via the Data API. Routes per content
 *   type (Short / Live Stream / Community Post / Video) and exposes inbox
 *   methods (getComments, postReply) on top of the publish/render contract.
 */
export class YouTubeAdapter implements ProviderAdapter {
  readonly id: ProviderId = "youtube";
  readonly limits: ProviderLimits = YOUTUBE_LIMITS;
  readonly capabilities = YOUTUBE_CAPABILITIES;
  readonly metadata: ProviderMetadata = YOUTUBE_METADATA;
  readonly constraints: ProviderConstraints = {};

  private readonly logger: Logger;
  private readonly apiClientFactory: YouTubeApiClientFactory;

  constructor(deps: YouTubeAdapterDeps = {}) {
    this.logger = deps.logger ?? pino({ name: "youtube-adapter", level: "info" });
    this.apiClientFactory = deps.apiClientFactory ?? defaultApiClientFactory;
  }

  /**
   * @method validateCredentials
   * @description Verifies that supplied credentials are well-formed and accepted
   *   by YouTube. Used by ConnectChannel before persisting a channel.
   */
  async validateCredentials(
    credentials: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const validation = validateCredentialStructure<YouTubeProviderCredentials>(
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
   * @description Validates that a canonical post fits YouTube's limits (description
   *   length, single video media) and builds the rendered content payload.
   */
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    const description = canonical.body;

    if (this.limits.maxChars && description.length > this.limits.maxChars) {
      return err("CONTENT_TOO_LONG");
    }

    if (!canonical.media || canonical.media.length === 0) {
      return err("VALIDATION_ERROR" as RenderError);
    }

    if (canonical.media.length > 1) {
      return err("VALIDATION_ERROR" as RenderError);
    }

    const videoMedia = canonical.media[0];
    if (!videoMedia || videoMedia.type !== "video") {
      return err("UNSUPPORTED_MEDIA" as RenderError);
    }

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
    });
  }

  /**
   * @method publish
   * @description Routes the rendered post to the correct publishing flow based on
   *   content type (Short / Community Post / Live Stream / Video) using the
   *   credentials supplied by the caller.
   */
  async publish(
    input: PublishInput,
    credentials: unknown
  ): Promise<Result<PublishReceipt, PublishError>> {
    const validation = validateCredentialStructure<YouTubeProviderCredentials>(
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
        case "SHORT":
          return await this.publishShort(validation.value, input.post);

        case "COMMUNITY_POST":
          return await this.publishCommunityPost(input.post);

        case "LIVE_STREAM":
          return await this.publishLiveStream(validation.value, input.post);

        case "VIDEO":
        default:
          return await this.publishVideo(apiClient, input.post);
      }
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "publish",
        channelId: input.channelId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(mapErrorToPublishError(error));
    }
  }

  /**
   * @method fetchAnalytics
   * @description Retrieves channel analytics for a given window. Falls back to
   *   NETWORK on transient/circuit-breaker errors and AUTH on credential issues.
   */
  async fetchAnalytics(
    q: { channelId: string; since?: Date; until?: Date },
    credentials: unknown
  ): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const validation = validateCredentialStructure<YouTubeProviderCredentials>(
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
      this.logger.error({
        provider: this.id,
        operation: "fetchAnalytics",
        channelId: q.channelId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err("NETWORK");
    }
  }

  /**
   * @method getComments
   * @description Fetches comments for a YouTube video via commentThreads.list.
   */
  async getComments(params: {
    channelCredentials: unknown;
    postExternalId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Result<{ comments: ProviderComment[]; nextCursor?: string }, "AUTH" | "NETWORK">> {
    if (!params.postExternalId) {
      return ok({ comments: [] });
    }

    const validation = validateCredentialStructure<YouTubeProviderCredentials>(
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
      this.logger.error({
        provider: this.id,
        operation: "getComments",
        videoId: params.postExternalId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        if (error.message.includes("401") || error.message.includes("403")) return err("AUTH");
      }
      return err("NETWORK");
    }
  }

  /**
   * @method postReply
   * @description Posts a reply to a YouTube comment via comments.insert.
   */
  async postReply(params: {
    channelCredentials: unknown;
    inReplyToProviderMessageId: string;
    body: string;
    postExternalId?: string;
  }): Promise<Result<ProviderReplyResult, "AUTH" | "NETWORK" | "RATE_LIMIT">> {
    const validation = validateCredentialStructure<YouTubeProviderCredentials>(
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
      this.logger.error({
        provider: this.id,
        operation: "postReply",
        parentId: params.inReplyToProviderMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        if (error.message.includes("401") || error.message.includes("403")) return err("AUTH");
        if (error.message.includes("429") || error.message.toLowerCase().includes("rate"))
          return err("RATE_LIMIT");
      }
      return err("NETWORK");
    }
  }

  /**
   * @method detectContentType
   * @description Inspects post metadata + media to choose the right publish flow.
   *   Order of precedence: explicit metadata.contentType / metadata.type, then
   *   shape-based heuristics (vertical short video, live indicators), then
   *   default VIDEO; an empty media array implies COMMUNITY_POST.
   */
  private detectContentType(
    post: RenderedPost
  ): "SHORT" | "COMMUNITY_POST" | "LIVE_STREAM" | "VIDEO" {
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

    if (post.media && post.media.length > 0) {
      const firstMedia = post.media[0];
      if (!firstMedia) {
        return "COMMUNITY_POST";
      }

      if (
        firstMedia.type === "video" &&
        (post.meta?.aspectRatio === "9:16" || post.meta?.isShort) &&
        (post.meta?.durationSeconds === undefined ||
          (typeof post.meta?.durationSeconds === "number" && post.meta.durationSeconds <= 60))
      ) {
        return "SHORT";
      }

      if (
        firstMedia.type === "video" &&
        (post.meta?.isLive || post.meta?.streamKey || post.meta?.scheduledStartTime)
      ) {
        return "LIVE_STREAM";
      }

      return "VIDEO";
    }

    return "COMMUNITY_POST";
  }

  /**
   * @method publishShort
   * @description Publishes a YouTube Short via the dedicated shorts service.
   */
  private async publishShort(
    credentials: YouTubeCredentials,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    try {
      const shortsService = new YouTubeShortsService(credentials);

      if (!post.media || post.media.length === 0) {
        return err("VALIDATION");
      }

      const video = post.media[0];
      if (!video || video.type !== "video") {
        return err("VALIDATION");
      }

      const title = (post.meta?.title as string) || post.body.split("\n")[0] || "Untitled Short";
      const description = post.body || "";
      const tags = (post.meta?.tags as string[]) || [];
      const privacy = (post.meta?.privacy as "public" | "private" | "unlisted") || "public";
      const categoryId = (post.meta?.categoryId as string) || "24";

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
      this.logger.error({
        provider: this.id,
        operation: "publishShort",
        error: error instanceof Error ? error.message : String(error),
      });
      return err(mapErrorToPublishError(error));
    }
  }

  /**
   * @method publishCommunityPost
   * @description OUT OF SCOPE: YouTube Community Tab API requires YouTube Partner
   *   Program. Not available via standard Data API v3. Callers should check
   *   capabilities.communityPosts before attempting to publish community posts.
   */
  private async publishCommunityPost(
    _post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    return err("VALIDATION");
  }

  /**
   * @method publishLiveStream
   * @description Creates a YouTube live stream broadcast via the live streaming
   *   service, propagating optional latency / DVR / auto-start flags.
   */
  private async publishLiveStream(
    credentials: YouTubeCredentials,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    try {
      const liveService = new YouTubeLiveStreamingService(credentials);

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
      this.logger.error({
        provider: this.id,
        operation: "publishLiveStream",
        error: error instanceof Error ? error.message : String(error),
      });
      return err(mapErrorToPublishError(error));
    }
  }

  /**
   * @method publishVideo
   * @description Uploads a regular YouTube video. Default privacy is public; tags
   *   come from post.meta.tags when present.
   */
  private async publishVideo(
    apiClient: YouTubeApiClient,
    post: RenderedPost
  ): Promise<Result<PublishReceipt, PublishError>> {
    try {
      if (!post.media || post.media.length === 0) {
        return err("VALIDATION");
      }

      const videoMedia = post.media[0];
      if (!videoMedia) {
        return err("VALIDATION");
      }

      const titleMatch = post.body.split("\n")[0];
      const title = titleMatch && titleMatch.length > 0 ? titleMatch : "Untitled Video";
      const description = post.body || "";

      const result = await apiClient.uploadVideo({
        title,
        description,
        videoUrl: videoMedia.url,
        privacy: "public",
        tags: [],
      });

      return ok({
        providerPostId: result.id,
        url: `https://www.youtube.com/watch?v=${result.id}`,
        publishedAt: new Date(result.publishedAt),
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "publishVideo",
        error: error instanceof Error ? error.message : String(error),
      });
      return err(mapErrorToPublishError(error));
    }
  }
}

/**
 * @function createYouTubeAdapter
 * @description Factory used by the composition root to instantiate the adapter
 *   with explicit dependencies (logger, optional client factory for tests).
 */
export function createYouTubeAdapter(deps: YouTubeAdapterDeps = {}): YouTubeAdapter {
  return new YouTubeAdapter(deps);
}
